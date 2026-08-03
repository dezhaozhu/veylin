/** Resolve context-window size for the composer ring / TokenLimiter / autocompact. */

import {
  DEFAULT_CONTEXT_WINDOW_FALLBACK,
  lookupKnownModelContextWindow,
} from './known-model-context-windows.js';

export type ModelContextWindowSource = {
  id?: string;
  label?: string;
  modelId?: string;
  /** From catalog file or provider `/models` metadata. */
  contextWindow?: number;
};

/** Return explicit catalog/provider contextWindow when present; otherwise null. */
export function resolveModelContextWindow(
  source: ModelContextWindowSource,
): number | null {
  if (
    typeof source.contextWindow === 'number' &&
    Number.isFinite(source.contextWindow) &&
    source.contextWindow > 0
  ) {
    return Math.floor(source.contextWindow);
  }
  return null;
}

/**
 * Sync resolve: explicit catalog value → exact modelId registry → 272k fallback.
 * (Provider `/models` is async — use {@link resolveContextWindowWithProvider}.)
 */
export function resolveContextWindowSize(source: ModelContextWindowSource): number {
  const explicit = resolveModelContextWindow(source);
  if (explicit != null) return explicit;

  const known =
    lookupKnownModelContextWindow(source.modelId) ??
    lookupKnownModelContextWindow(source.id);
  if (known != null) return known;

  return DEFAULT_CONTEXT_WINDOW_FALLBACK;
}
