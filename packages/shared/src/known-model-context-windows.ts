/** Exact modelId → context window (docs). No substring / name heuristics. */

/** Codex-style fallback when catalog, provider `/models`, and registry all miss. */
export const DEFAULT_CONTEXT_WINDOW_FALLBACK = 272_000;

/**
 * Known provider model ids (lowercase). Values from vendor docs / pricing pages.
 * Prefer catalog `contextWindow` or `/models` metadata when available.
 */
export const KNOWN_MODEL_CONTEXT_WINDOWS: Readonly<Record<string, number>> = {
  'deepseek-v4-flash': 1_048_576,
  'deepseek-v4-pro': 1_048_576,
  'deepseek-chat': 1_048_576,
  'deepseek-reasoner': 1_048_576,
};

function normalizeModelId(modelId: string): string {
  return modelId.trim().toLowerCase();
}

/**
 * Exact id match, or `org/model` / `org:model` suffix equal to a known id.
 * Never uses includes() guessing.
 */
export function lookupKnownModelContextWindow(modelId: string | undefined): number | null {
  if (!modelId?.trim()) return null;
  const target = normalizeModelId(modelId);
  const direct = KNOWN_MODEL_CONTEXT_WINDOWS[target];
  if (direct != null) return direct;

  const slash = target.lastIndexOf('/');
  const colon = target.lastIndexOf(':');
  const sep = Math.max(slash, colon);
  if (sep >= 0 && sep < target.length - 1) {
    const suffix = target.slice(sep + 1);
    const fromSuffix = KNOWN_MODEL_CONTEXT_WINDOWS[suffix];
    if (fromSuffix != null) return fromSuffix;
  }
  return null;
}
