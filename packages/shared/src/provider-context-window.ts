/** Fetch / parse provider model metadata for context-window size (OpenAI-compatible). */

import {
  resolveContextWindowSize,
  resolveModelContextWindow,
  type ModelContextWindowSource,
} from './model-context-window.js';

const CACHE_TTL_MS = 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 60 * 1000;

type CacheEntry = { value: number | null; expiresAt: number };

const cache = new Map<string, CacheEntry>();

export function clearProviderContextWindowCache(): void {
  cache.clear();
}

function asPositiveInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const n = Number(value.trim());
    return n > 0 ? n : null;
  }
  return null;
}

/**
 * Read context window from a single `/models` list item.
 * Supports OpenRouter (`context_length`), vLLM (`max_model_len`), and similar aliases.
 */
export function extractContextWindowFromModelRecord(record: unknown): number | null {
  if (!record || typeof record !== 'object') return null;
  const r = record as Record<string, unknown>;
  const topProvider =
    r.top_provider && typeof r.top_provider === 'object'
      ? (r.top_provider as Record<string, unknown>)
      : undefined;
  const limits =
    r.limits && typeof r.limits === 'object' ? (r.limits as Record<string, unknown>) : undefined;
  const meta = r.meta && typeof r.meta === 'object' ? (r.meta as Record<string, unknown>) : undefined;

  const candidates = [
    r.context_length,
    r.contextLength,
    r.max_model_len,
    r.max_input_tokens,
    r.maxInputTokens,
    r.max_context_length,
    topProvider?.context_length,
    topProvider?.contextLength,
    limits?.max_context_tokens,
    limits?.context_length,
    meta?.context_length,
    meta?.contextLength,
  ];

  for (const candidate of candidates) {
    const n = asPositiveInt(candidate);
    if (n != null) return n;
  }
  return null;
}

function modelRecordId(record: unknown): string {
  if (!record || typeof record !== 'object') return '';
  const id = (record as { id?: unknown }).id;
  return typeof id === 'string' ? id.trim().toLowerCase() : '';
}

/** Match provider list entry to a catalog `modelId` (exact, suffix, or contains). */
export function findModelRecordInList(
  models: readonly unknown[],
  modelId: string,
): unknown | undefined {
  const target = modelId.trim().toLowerCase();
  if (!target || !Array.isArray(models)) return undefined;

  const exact = models.find((m) => modelRecordId(m) === target);
  if (exact) return exact;

  const suffix = models.find((m) => {
    const id = modelRecordId(m);
    return id.endsWith(`/${target}`) || id.endsWith(`:${target}`);
  });
  if (suffix) return suffix;

  return models.find((m) => {
    const id = modelRecordId(m);
    return id.includes(target) || target.includes(id);
  });
}

function cacheKey(baseUrl: string, modelId: string): string {
  return `${baseUrl.replace(/\/$/, '')}|${modelId.trim().toLowerCase()}`;
}

/**
 * GET `{baseUrl}/models` and return context window for `modelId`.
 * Results are cached (including short negative cache on failure).
 */
export async function fetchProviderModelContextWindow(opts: {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  signal?: AbortSignal;
}): Promise<number | null> {
  const base = opts.baseUrl.trim().replace(/\/$/, '');
  const modelId = opts.modelId.trim();
  if (!base || !modelId) return null;

  const key = cacheKey(base, modelId);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  try {
    const res = await fetch(`${base}/models`, {
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        Accept: 'application/json',
      },
      signal: opts.signal ?? AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      cache.set(key, { value: null, expiresAt: Date.now() + NEGATIVE_TTL_MS });
      return null;
    }
    const json: unknown = await res.json();
    const list = Array.isArray(json)
      ? json
      : json &&
          typeof json === 'object' &&
          Array.isArray((json as { data?: unknown }).data)
        ? ((json as { data: unknown[] }).data)
        : [];
    const record = findModelRecordInList(list, modelId);
    const value = record ? extractContextWindowFromModelRecord(record) : null;
    cache.set(key, {
      value,
      expiresAt: Date.now() + (value != null ? CACHE_TTL_MS : NEGATIVE_TTL_MS),
    });
    return value;
  } catch {
    cache.set(key, { value: null, expiresAt: Date.now() + NEGATIVE_TTL_MS });
    return null;
  }
}

/** Prefer catalog override → provider `/models` → known modelId table → 272k. */
export async function resolveContextWindowWithProvider(opts: {
  baseUrl: string;
  apiKey: string;
  source: ModelContextWindowSource & { modelId: string };
  signal?: AbortSignal;
}): Promise<number> {
  const { source } = opts;
  const fromCatalog = resolveModelContextWindow(source);
  if (fromCatalog != null) return fromCatalog;

  const fromProvider = await fetchProviderModelContextWindow({
    baseUrl: opts.baseUrl,
    apiKey: opts.apiKey,
    modelId: source.modelId,
    signal: opts.signal,
  });
  if (fromProvider != null) return fromProvider;

  return resolveContextWindowSize(source);
}
