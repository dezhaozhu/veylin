/**
 * Stream helpers that attach last-step provider usage to the UI message stream
 * (Claude Code semantics: context % uses the latest API input + cache tokens).
 */

export const CONTEXT_USAGE_DATA_PART = 'data-veylin-context-usage';
export const CONTEXT_USAGE_DATA_PART_ID = 'veylin-context-usage';

export type VeylinContextUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
};

function asNonNegNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Normalize AI SDK / Mastra usage shapes into a stable camelCase payload. */
export function normalizeContextUsage(raw: unknown): VeylinContextUsage | null {
  if (!raw || typeof raw !== 'object') return null;
  const u = raw as Record<string, unknown>;
  const details =
    u.inputTokenDetails && typeof u.inputTokenDetails === 'object'
      ? (u.inputTokenDetails as Record<string, unknown>)
      : null;

  const input =
    asNonNegNumber(u.inputTokens) ??
    asNonNegNumber(u.input_tokens);
  if (input == null) return null;

  const output =
    asNonNegNumber(u.outputTokens) ??
    asNonNegNumber(u.output_tokens) ??
    0;

  const cachedInputTokens =
    asNonNegNumber(u.cachedInputTokens) ??
    asNonNegNumber(u.cache_read_input_tokens) ??
    asNonNegNumber(u.cacheReadInputTokens) ??
    asNonNegNumber(details?.cacheReadTokens) ??
    0;

  const cacheCreationInputTokens =
    asNonNegNumber(u.cacheCreationInputTokens) ??
    asNonNegNumber(u.cache_creation_input_tokens) ??
    asNonNegNumber(details?.cacheWriteTokens) ??
    0;

  return {
    inputTokens: input,
    outputTokens: output,
    ...(cachedInputTokens > 0 ? { cachedInputTokens } : {}),
    ...(cacheCreationInputTokens > 0 ? { cacheCreationInputTokens } : {}),
  };
}

/** Stable-id data part so redelivery upserts instead of appending. */
export function buildContextUsageStreamChunk(raw: unknown): {
  type: typeof CONTEXT_USAGE_DATA_PART;
  id: string;
  data: VeylinContextUsage;
} | null {
  const data = normalizeContextUsage(raw);
  if (!data) return null;
  return {
    type: CONTEXT_USAGE_DATA_PART,
    id: CONTEXT_USAGE_DATA_PART_ID,
    data,
  };
}
