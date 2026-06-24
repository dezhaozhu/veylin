/**
 * Reconnect policy aligned with the agent SSETransport
 * (src/cli/transports/SSETransport.ts).
 */

export const RECONNECT_BASE_DELAY_MS = 1_000;
export const RECONNECT_MAX_DELAY_MS = 30_000;
/** Time budget for reconnection attempts before giving up (10 minutes). */
export const RECONNECT_GIVE_UP_MS = 600_000;
/** Server sends keepalives every 15s; treat connection as dead after 45s of silence. */
export const LIVENESS_TIMEOUT_MS = 45_000;

/** HTTP status codes that indicate a permanent server-side rejection. */
export const PERMANENT_HTTP_CODES = new Set([401, 403, 404]);

/** POST retry configuration (matches the agent HybridTransport / SSETransport.write). */
export const POST_MAX_RETRIES = 10;
export const POST_BASE_DELAY_MS = 500;
export const POST_MAX_DELAY_MS = 8_000;

const FINISH_MARKER = '"type":"finish"';

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { name?: string; message?: string };
  return err.name === 'AbortError' || /aborted/i.test(err.message || '');
}

export function isPermanentHttpStatus(status: number): boolean {
  return PERMANENT_HTTP_CODES.has(status);
}

/** 429 or 5xx — retry; other 4xx are permanent (the agent POST policy). */
export function shouldRetryPost(status: number): boolean {
  if (status === 429) return true;
  if (status >= 500) return true;
  return false;
}

export function isPostSuccess(status: number): boolean {
  return status === 200 || status === 201;
}

/**
 * SSE stream reconnect delay with ±25% jitter
 * (the agent handleConnectionError).
 */
export function getStreamReconnectDelay(attempt: number): number {
  const baseDelay = Math.min(
    RECONNECT_BASE_DELAY_MS * Math.pow(2, Math.max(0, attempt - 1)),
    RECONNECT_MAX_DELAY_MS,
  );
  return Math.max(0, baseDelay + baseDelay * 0.25 * (2 * Math.random() - 1));
}

/** POST retry delay without jitter (the agent write loop). */
export function getPostRetryDelay(attempt: number): number {
  return Math.min(
    POST_BASE_DELAY_MS * Math.pow(2, Math.max(0, attempt - 1)),
    POST_MAX_DELAY_MS,
  );
}

export function sleepMs(
  ms: number,
  signal?: AbortSignal | null,
): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      globalThis.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function hasStreamFinished(accumulator: string): boolean {
  return accumulator.includes(FINISH_MARKER);
}

export type PostWithRetryOptions = {
  signal?: AbortSignal | null;
  sleep?: (ms: number, signal?: AbortSignal | null) => Promise<void>;
  onRetry?: (info: { attempt: number; delayMs: number; reason: string }) => void;
};

/**
 * Retry POST /api/chat before the response body is consumed
 * (the agent SSETransport.write).
 */
export async function postChatWithRetry(
  fetcher: () => Promise<Response>,
  options: PostWithRetryOptions = {},
): Promise<Response> {
  const sleep = options.sleep ?? sleepMs;

  for (let attempt = 1; attempt <= POST_MAX_RETRIES; attempt += 1) {
    if (options.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    try {
      const response = await fetcher();

      if (isPostSuccess(response.status)) {
        return response;
      }

      if (isPermanentHttpStatus(response.status)) {
        return response;
      }

      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 429
      ) {
        return response;
      }

      if (!shouldRetryPost(response.status) || attempt === POST_MAX_RETRIES) {
        return response;
      }

      const delayMs = getPostRetryDelay(attempt);
      options.onRetry?.({
        attempt,
        delayMs,
        reason: `http_${response.status}`,
      });
      await sleep(delayMs, options.signal);
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (attempt === POST_MAX_RETRIES) throw error;

      const delayMs = getPostRetryDelay(attempt);
      options.onRetry?.({
        attempt,
        delayMs,
        reason: error instanceof Error ? error.message : 'network_error',
      });
      await sleep(delayMs, options.signal);
    }
  }

  throw new Error('POST retry exhausted');
}

export type StreamReconnectLoopOptions = {
  signal?: AbortSignal | null;
  sleep?: (ms: number, signal?: AbortSignal | null) => Promise<void>;
  giveUpMs?: number;
  onReconnect?: (info: {
    attempt: number;
    delayMs: number;
    elapsedMs: number;
    reason: string;
  }) => void;
};

/**
 * Connection-level reconnect loop with a time budget
 * (the agent handleConnectionError + connect).
 */
export async function runWithStreamReconnectBudget<T>(
  run: () => Promise<T>,
  options: StreamReconnectLoopOptions = {},
): Promise<T> {
  const giveUpMs = options.giveUpMs ?? RECONNECT_GIVE_UP_MS;
  const sleep = options.sleep ?? sleepMs;
  const reconnectStartTime = Date.now();
  let attempt = 0;

  while (true) {
    if (options.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const elapsedMs = Date.now() - reconnectStartTime;
    if (elapsedMs >= giveUpMs) {
      throw new Error(
        `Reconnection time budget exhausted after ${Math.round(elapsedMs / 1000)}s`,
      );
    }

    try {
      return await run();
    } catch (error) {
      if (isAbortError(error)) throw error;

      attempt += 1;
      const delayMs = getStreamReconnectDelay(attempt);
      options.onReconnect?.({
        attempt,
        delayMs,
        elapsedMs,
        reason: error instanceof Error ? error.message : 'connection_error',
      });
      await sleep(delayMs, options.signal);
    }
  }
}
