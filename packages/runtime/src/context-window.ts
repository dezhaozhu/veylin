import {
  getCatalogModel,
  getDefaultCatalogModel,
  resolveContextWindowSize,
} from '@veylin/shared/node';

/** Claude Code–style headroom before the hard context limit. */
export const AUTOCOMPACT_BUFFER_TOKENS = 13_000;

/** Reserve up to this many tokens for compact/summary output (CC caps similarly). */
export const COMPACT_RESERVED_OUTPUT_TOKENS = 20_000;

const MAX_CONSECUTIVE_FAILURES = 3;

let consecutiveCompactFailures = 0;
let autoCompactDisabled = false;

function envPositiveNumber(key: string): number | null {
  const raw = process.env[key]?.trim();
  if (!raw) return null;
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Parse VEYLIN_AUTOCOMPACT_PCT only when set (Claude Code override semantics).
 * Accepts fraction (`0.05`) or percent (`5` → 0.05).
 */
export function readAutocompactPctOverride(): number | null {
  const raw = process.env.VEYLIN_AUTOCOMPACT_PCT?.trim();
  if (!raw) return null;
  const v = Number(raw);
  if (!Number.isFinite(v) || v <= 0) return null;
  const fraction = v > 1 ? v / 100 : v;
  if (fraction <= 0 || fraction > 1) return null;
  return fraction;
}

/** Resolve model context window: env fixture → catalog/registry/272k. */
export function getContextWindowSize(modelKey?: string): number {
  const envLimit = envPositiveNumber('VEYLIN_TOKEN_LIMIT');
  if (envLimit != null) return Math.floor(envLimit);

  const entry = modelKey
    ? getCatalogModel(modelKey) ??
      (modelKey === 'default' ? getDefaultCatalogModel() : undefined)
    : getDefaultCatalogModel();

  if (entry) {
    return resolveContextWindowSize({
      id: entry.id,
      label: entry.label,
      modelId: entry.modelId,
      contextWindow: entry.contextWindow,
    });
  }

  return resolveContextWindowSize({
    id: modelKey,
    modelId: modelKey,
  });
}

/**
 * Effective window for autocompact decisions:
 * contextWindow − reservedOutput, optionally clamped by VEYLIN_AUTOCOMPACT_WINDOW.
 */
export function getEffectiveContextWindowSize(modelKey?: string): number {
  let window = getContextWindowSize(modelKey);
  const clamp = envPositiveNumber('VEYLIN_AUTOCOMPACT_WINDOW');
  if (clamp != null) window = Math.min(window, clamp);

  const reserved =
    envPositiveNumber('VEYLIN_COMPACT_RESERVED_OUTPUT') ?? COMPACT_RESERVED_OUTPUT_TOKENS;
  const reservedCapped = Math.min(reserved, COMPACT_RESERVED_OUTPUT_TOKENS);
  return Math.max(1000, window - reservedCapped);
}

/**
 * Autocompact when token estimate ≥ this threshold.
 * Default: effectiveWindow − 13k (Claude Code).
 * Optional VEYLIN_AUTOCOMPACT_PCT: min(floor(effective×pct), defaultThreshold).
 */
export function getAutoCompactThreshold(modelKey?: string): number {
  const effective = getEffectiveContextWindowSize(modelKey);
  const buffer = envPositiveNumber('VEYLIN_AUTOCOMPACT_BUFFER') ?? AUTOCOMPACT_BUFFER_TOKENS;
  const defaultThreshold = Math.max(1000, effective - buffer);

  const pct = readAutocompactPctOverride();
  if (pct != null) {
    return Math.max(1000, Math.min(Math.floor(effective * pct), defaultThreshold));
  }
  return defaultThreshold;
}

export function isAutoCompactDisabled(): boolean {
  return autoCompactDisabled;
}

export function recordCompactSuccess(): void {
  consecutiveCompactFailures = 0;
  autoCompactDisabled = false;
}

export function recordCompactFailure(): void {
  consecutiveCompactFailures += 1;
  if (consecutiveCompactFailures >= MAX_CONSECUTIVE_FAILURES) {
    autoCompactDisabled = true;
  }
}

export function resetCompactCircuitBreaker(): void {
  consecutiveCompactFailures = 0;
  autoCompactDisabled = false;
}
