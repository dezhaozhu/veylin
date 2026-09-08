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
  /** 宿主内部:甘特点条带作业号过来。不从对话消息解析。 */
  job_id?: string;
  /** 宿主内部:发起定位那一面的排产运行 id(跨面版本比对)。不从对话消息解析。 */
  run_id?: string;
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

/**
 * 排产即导航 · 通用锚点。Compass 的卡片(甘特 SVG 等)点一下,告诉宿主「去看这道
 * 作业」;锚点只带 Compass 自己的身份(作业号/订单号/开工日),**去哪个面板由
 * 宿主决定**。`surface` 是卡片的建议,不是命令 —— 宿主没装甘特就退到表格。
 * 安全模型与 open-schedule-grid 完全一致:固定 type+action、字段消毒封顶、
 * 其余一律静默丢弃;线程/租户永远来自宿主上下文,消息选不了目标。
 */
export type NavigateTarget = {
  /** job/order = 定位到一道作业/一个订单;view = 只把甘特切到某个视角(id = resource|workshop|order);
   * resource = 一个资源**编码**(如 JG0505-1),甘特翻到含它那条泳道并高亮,不在模型泳道里时如实说。 */
  kind: 'job' | 'order' | 'view' | 'resource';
  id: string;
  orderId?: string;
  /** 开工日 YYYY-MM-DD —— 甘特默认窗对不上这一行时用它挪窗。 */
  at?: string;
  /** 卡片所看到的排产运行 id(甘特卡片 meta.run_id);落地面拿它比版本。 */
  runId?: string;
  surface: 'gantt' | 'grid';
};

const NAVIGATE_KINDS = new Set(['job', 'order', 'view', 'resource']);
const NAVIGATE_VIEWS = new Set(['resource', 'workshop', 'order']);
const NAVIGATE_SURFACES = new Set(['gantt', 'grid']);

export function parseNavigateMessage(data: unknown): NavigateTarget | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.type !== 'veylin:action' || d.action !== 'navigate') return null;
  const p =
    typeof d.payload === 'object' && d.payload !== null ? (d.payload as Record<string, unknown>) : {};
  const a =
    typeof p.anchor === 'object' && p.anchor !== null ? (p.anchor as Record<string, unknown>) : null;
  if (!a) return null;
  const kind = typeof a.kind === 'string' ? a.kind : '';
  const surface = typeof p.surface === 'string' ? p.surface : 'gantt';
  if (!NAVIGATE_KINDS.has(kind) || !NAVIGATE_SURFACES.has(surface)) return null;
  const id = sanitizeField(a.id, CORRECTION_FIELD_MAX);
  const orderId = sanitizeField(a.order_id, CORRECTION_FIELD_MAX);
  const at = sanitizeField(a.at, CORRECTION_FIELD_MAX);
  const runId = sanitizeField(a.run_id, CORRECTION_FIELD_MAX);
  if (id === null || orderId === null || at === null || runId === null || !id) return null;
  if (kind === 'view' && !NAVIGATE_VIEWS.has(id)) return null;
  // 开工日只认 YYYY-MM-DD 前缀 —— 甘特按日挪窗,别的形状一律不带。
  const atDay = at ? /^(\d{4}-\d{2}-\d{2})/.exec(at)?.[1] : undefined;
  const out: NavigateTarget = { kind: kind as NavigateTarget['kind'], id, surface: surface as NavigateTarget['surface'] };
  if (orderId) out.orderId = orderId;
  if (atDay) out.at = atDay;
  if (runId) out.runId = runId;
  return out;
}

/**
 * Does this drill mean "show late orders only"? `status:"late"` is the sole
 * positioning compass emits today (workshop/order_id live on OpenGridFilter for
 * forward-compat but are never sent). Lateness is a COMPUTED predicate (a row's
 * planned end vs its due date), not a column value — so the grid expresses it as
 * an AG-Grid external filter, gated on this decision. Anything else (another
 * status, or none) means "no positioning": the grid just opens.
 */
export function isLateOnlyGridFilter(filter: OpenGridFilter | null | undefined): boolean {
  return filter?.status === 'late';
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
