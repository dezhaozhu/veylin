/**
 * 修正桥 (correction bridge) — pure logic for the widget→host action bridge
 * (scene-card v2 Phase 3). A compass MCP-App widget's per-section "这里不对?"
 * button posts `{type: 'veylin:action', action: 'open-correction', payload}`
 * to `window.parent`; the host component (mcp-app-action-bridge.tsx) verifies
 * the event came from ITS OWN widget iframe, then parses the data here.
 *
 * Security invariants (binding, from the spec):
 * - The host derives the target project/thread from its OWN React context —
 *   NOTHING in the message ever selects a target. Payload strings are
 *   untrusted display text that lands only in a user-editable composer draft.
 * - Only the `open-correction` action exists. Any other message shape is
 *   ignored silently (no logging channel for the widget to probe).
 * - Every payload field is size-capped (oversized ⇒ the whole message is
 *   dropped, not truncated — a well-behaved widget caps before sending) and
 *   control/bidi/zero-width characters are stripped.
 * - Nothing is ever auto-sent; the draft waits for the user.
 */

export type CorrectionPayload = {
  /** Scene name as CLAIMED by the widget — display-text only; the 项目首页
   * context ignores it entirely in favor of its own `source` prop. */
  scene: string;
  /** Stable section key (e.g. `capacity`). */
  section: string;
  /** Human-readable section label (e.g. 产能口径). */
  label: string;
  /** ≤500-char plain-text snapshot of the section's display values. */
  current: string;
};

/** Per-field caps — mirror the widget-side contract exactly. */
export const CORRECTION_FIELD_MAX = 100;
export const CORRECTION_CURRENT_MAX = 500;

// C0 controls (incl. \t\r\n handled separately), DEL + C1, zero-width and
// bidi-override characters (defense against direction-spoofed draft text),
// line/paragraph separators.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069\uFEFF]/g;

function sanitizeField(value: unknown, max: number): string | null {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return null;
  // Cheap pre-cap before any regex work: a message this far over the cap is
  // hostile or corrupt either way — drop without scanning megabytes.
  if (value.length > max * 10) return null;
  const cleaned = value
    .replace(/[\t\r\n]+/g, ' ')
    .replace(CONTROL_CHARS, '')
    .replace(/ {2,}/g, ' ')
    .trim();
  if (cleaned.length > max) return null;
  return cleaned;
}

/**
 * Validate + sanitize a `message` event's data as an open-correction action.
 * Returns null for ANYTHING that is not exactly the whitelisted shape:
 * wrong type/action, non-object payload, non-string fields, oversized fields
 * (scene/section/label > 100 chars, current > 500 — after control-char
 * stripping), or a payload naming no section at all. Missing optional fields
 * sanitize to ''. The caller ignores null silently.
 */
export function parseCorrectionMessage(data: unknown): CorrectionPayload | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.type !== 'veylin:action' || d.action !== 'open-correction') return null;
  if (typeof d.payload !== 'object' || d.payload === null) return null;
  const p = d.payload as Record<string, unknown>;

  const scene = sanitizeField(p.scene, CORRECTION_FIELD_MAX);
  const section = sanitizeField(p.section, CORRECTION_FIELD_MAX);
  const label = sanitizeField(p.label, CORRECTION_FIELD_MAX);
  const current = sanitizeField(p.current, CORRECTION_CURRENT_MAX);
  if (scene === null || section === null || label === null || current === null) return null;
  // A correction must reference SOME section — a payload naming none is noise.
  if (!label && !section) return null;

  return { scene, section, label, current };
}

/**
 * Optional filters for the schedule-grid drill. Each is an untrusted display
 * string (sanitized + capped like correction fields). They only NARROW which
 * rows load into the CURRENT thread's schedule grid — thread/tenant are always
 * host-derived, so a filter can never select a different thread or tenant.
 */
export type OpenGridFilter = {
  status?: string;
  workshop?: string;
  order_id?: string;
};

/**
 * Validate + sanitize a `veylin:action` / `open-schedule-grid` message (the
 * constraint-cockpit widget's "展开排产表" drill — "open the map, positioned").
 * Returns an OpenGridFilter (possibly empty) for the exact shape, else null.
 * Same security model as parseCorrectionMessage: fixed type+action, sanitized
 * capped string fields, silent drop of anything else. Opening/target is host
 * context (current thread's grid); the payload only carries display filters.
 */
export function parseOpenGridMessage(data: unknown): OpenGridFilter | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.type !== 'veylin:action' || d.action !== 'open-schedule-grid') return null;
  const p =
    typeof d.payload === 'object' && d.payload !== null ? (d.payload as Record<string, unknown>) : {};
  const status = sanitizeField(p.status, CORRECTION_FIELD_MAX);
  const workshop = sanitizeField(p.workshop, CORRECTION_FIELD_MAX);
  const orderId = sanitizeField(p.order_id, CORRECTION_FIELD_MAX);
  if (status === null || workshop === null || orderId === null) return null;
  const out: OpenGridFilter = {};
  if (status) out.status = status;
  if (workshop) out.workshop = workshop;
  if (orderId) out.order_id = orderId;
  return out;
}

export type CorrectionDraftSpec = {
  /** i18n key under `correctionBridge.` — variant depends on which optional
   * pieces (scene label, current snapshot) actually exist; no template ever
   * renders an empty 「」 or a dangling colon. */
  key: 'correctionBridge.draft' | 'correctionBridge.draftNoScene' | 'correctionBridge.draftNoCurrent' | 'correctionBridge.draftBare';
  vars: { scene: string; label: string; current: string };
};

/**
 * Draft composition (pure half): pick the i18n template + interpolation vars
 * for the composer prefill. `sceneLabel` is chosen by the CALLER per the
 * security invariant — 项目首页 context passes its own source's label (host
 * context, never the message); the in-chat context has no host-side scene
 * knowledge and passes the sanitized display-text `payload.scene`. The
 * section's human label wins over the stable key; parse guarantees at least
 * one is non-empty.
 */
export function correctionDraftSpec(sceneLabel: string, p: CorrectionPayload): CorrectionDraftSpec {
  const label = p.label || p.section;
  const scene = sceneLabel.trim();
  const key = scene
    ? (p.current ? 'correctionBridge.draft' : 'correctionBridge.draftNoCurrent')
    : (p.current ? 'correctionBridge.draftNoScene' : 'correctionBridge.draftBare');
  return { key, vars: { scene, label, current: p.current } };
}
