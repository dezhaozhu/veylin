import { LIVENESS_TIMEOUT_MS } from '@/lib/transport-reconnect';

export type StreamLivenessOptions = {
  timeoutMs?: number;
  signal?: AbortSignal | null;
  onLivenessTimeout?: () => void;
  onActivity?: () => void;
};

/**
 * Reset liveness on every chunk — mirrors the agent resetLivenessTimer().
 * Aborts the stream when no bytes arrive within LIVENESS_TIMEOUT_MS (45s).
 */
export function wrapStreamWithLiveness(
  body: ReadableStream<Uint8Array>,
  options: StreamLivenessOptions = {},
): ReadableStream<Uint8Array> {
  const timeoutMs = options.timeoutMs ?? LIVENESS_TIMEOUT_MS;
  const reader = body.getReader();
  let livenessTimer: ReturnType<typeof globalThis.setTimeout> | undefined;

  const clearLivenessTimer = () => {
    if (livenessTimer != null) {
      globalThis.clearTimeout(livenessTimer);
      livenessTimer = undefined;
    }
  };

  const resetLivenessTimer = () => {
    clearLivenessTimer();
    livenessTimer = globalThis.setTimeout(() => {
      livenessTimer = undefined;
      options.onLivenessTimeout?.();
      void reader.cancel(
        new DOMException('liveness_timeout', 'AbortError'),
      );
    }, timeoutMs);
  };

  const onAbort = () => {
    clearLivenessTimer();
    void reader.cancel(new DOMException('Aborted', 'AbortError'));
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });

  resetLivenessTimer();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          clearLivenessTimer();
          options.signal?.removeEventListener('abort', onAbort);
          controller.close();
          return;
        }
        resetLivenessTimer();
        options.onActivity?.();
        controller.enqueue(value);
      } catch (error) {
        clearLivenessTimer();
        options.signal?.removeEventListener('abort', onAbort);
        controller.error(error);
      }
    },
    cancel(reason) {
      clearLivenessTimer();
      options.signal?.removeEventListener('abort', onAbort);
      return reader.cancel(reason);
    },
  });
}
