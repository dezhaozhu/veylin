import { RESUMABLE_STREAM_ID_HEADER } from '@assistant-ui/react-ai-sdk';
import i18n from '@/i18n';
import { useNetworkReconnectStore } from '@/lib/network-reconnect-store';
import { resumableStorage } from '@/lib/resumable-storage';
import { clearActiveChatRun, setActiveChatRun } from '@/lib/active-chat-run';
import {
  advanceCursorBySseBytes,
  cursorToSequenceNum,
  getResumeCursor,
  setResumeCursor,
} from '@/lib/stream-resume-cursor';
import {
  getStreamReconnectDelay,
  hasStreamFinished,
  isAbortError,
  isPermanentHttpStatus,
  isPostSuccess,
  isResumableStreamGone,
  postChatWithRetry,
  RECONNECT_GIVE_UP_MS,
  sleepMs,
} from '@/lib/transport-reconnect';
import { wrapStreamWithLiveness } from '@/lib/wrap-stream-liveness';
import { isBenignChatError } from '@/lib/format-chat-error';
import { dispatchChatStreamRecovery } from '@/lib/chat-stream-recovery';

export type ResilientChatFetchOptions = {
  fetch?: typeof globalThis.fetch;
};

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function isChatPost(url: string, method: string): boolean {
  return method.toUpperCase() === 'POST' && /\/api\/chat\/?$/.test(url);
}

function isChatStreamResume(url: string, method: string): boolean {
  if (method.toUpperCase() !== 'GET') return false;
  return (
    /\/api\/chat\/[^/]+\/stream/.test(url) ||
    /\/api\/chat\/streams\//.test(url)
  );
}

function threadIdFromChatBody(body: BodyInit | null | undefined): string | null {
  if (typeof body !== 'string') return null;
  try {
    const parsed = JSON.parse(body) as { id?: unknown; threadId?: unknown };
    const id =
      (typeof parsed.id === 'string' && parsed.id) ||
      (typeof parsed.threadId === 'string' && parsed.threadId) ||
      '';
    return id || null;
  } catch {
    return null;
  }
}

async function readResponseErrorDetail(response: Response): Promise<string | undefined> {
  try {
    const text = (await response.clone().text()).trim();
    if (!text) return undefined;
    try {
      const json = JSON.parse(text) as { message?: string; error?: string };
      return json.message ?? json.error ?? text.slice(0, 200);
    } catch {
      return text.slice(0, 200);
    }
  } catch {
    return undefined;
  }
}

async function throwChatHttpError(prefix: 'chat' | 'resume' | 'stream_resume', response: Response): Promise<never> {
  const detail = await readResponseErrorDetail(response);
  throw new Error(detail ? `${prefix}_http_${response.status}:${detail}` : `${prefix}_http_${response.status}`);
}

function resumeHeaders(streamId: string): HeadersInit {
  const cursor = getResumeCursor(streamId);
  const seq = cursorToSequenceNum(cursor);
  const headers: Record<string, string> = {};
  if (cursor) headers['Last-Event-ID'] = cursor;
  return headers;
}

function resumeUrl(baseUrl: string, streamId: string): string {
  const cursor = getResumeCursor(streamId);
  const seq = cursorToSequenceNum(cursor);
  if (seq <= 0) return baseUrl;
  const sep = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${sep}from_sequence_num=${seq}`;
}

function isBenignResumeError(error: unknown): boolean {
  return isBenignChatError(error);
}

/**
 * the agent SSETransport-style fetch:
 * - POST write retry (10×)
 * - 45s liveness per connection
 * - Mid-stream disconnect → GET resume with Last-Event-ID / from_sequence_num
 * - 10min reconnect budget
 */
export function createResilientChatFetch(
  options: ResilientChatFetchOptions = {},
): typeof globalThis.fetch {
  const baseFetch = options.fetch ?? globalThis.fetch.bind(globalThis);

  return async (input, init) => {
    const url = resolveUrl(input as RequestInfo | URL);
    const method = init?.method ?? 'GET';

    if (!isChatPost(url, method) && !isChatStreamResume(url, method)) {
      return baseFetch(input as RequestInfo | URL, init);
    }

    if (isChatStreamResume(url, method)) {
      return reconnectingGetStream(baseFetch, input as RequestInfo | URL, init);
    }

    return resilientChatPost(baseFetch, input as RequestInfo | URL, init);
  };
}

async function reconnectingGetStream(
  baseFetch: typeof globalThis.fetch,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const signal = init?.signal ?? null;
  const banner = useNetworkReconnectStore.getState();
  const reconnectStartTime = Date.now();
  let attempt = 0;

  while (Date.now() - reconnectStartTime < RECONNECT_GIVE_UP_MS) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    try {
      const response = await baseFetch(input, init);
      if (response.status === 204) return response;
      if (response.status === 204 || response.status === 404) {
        resumableStorage.clear();
        clearActiveChatRun();
        banner.clearTransientBanner();
        return response;
      }
      if (isPermanentHttpStatus(response.status)) return response;
      if (!response.ok) {
        await throwChatHttpError('stream_resume', response);
      }
      if (!response.body) {
        throw new Error('empty_response_body');
      }
      if (attempt > 0) banner.clearReconnecting();

      const streamId = response.headers.get(RESUMABLE_STREAM_ID_HEADER) ?? '';
      const body = wrapTrackedStream(response.body, {
        signal,
        streamId,
        onLivenessTimeout: () => {
          banner.setReconnecting({
            attempt: attempt + 1,
            delayMs: 0,
            elapsedMs: Date.now() - reconnectStartTime,
            reason: 'liveness_timeout',
          });
        },
      });

      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      attempt += 1;
      const elapsedMs = Date.now() - reconnectStartTime;
      if (elapsedMs >= RECONNECT_GIVE_UP_MS) break;

      const delayMs = getStreamReconnectDelay(attempt);
      banner.setReconnecting({
        attempt,
        delayMs,
        elapsedMs,
        reason: 'stream_resume',
      });
      await sleepMs(delayMs, signal);
    }
  }

  banner.setConnectionError(i18n.t('chatError.reconnectFailed.title'), i18n.t('chatError.reconnectExhausted'));
  throw new Error('stream resume reconnect exhausted');
}

async function resilientChatPost(
  baseFetch: typeof globalThis.fetch,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const signal = init?.signal ?? null;
  const banner = useNetworkReconnectStore.getState();
  const reconnectStartTime = Date.now();
  let reconnectAttempts = 0;
  let streamId = '';
  let finishedSeen = false;
  const decoder = new TextDecoder();
  let accumulator = '';
  const requestThreadId = threadIdFromChatBody(init?.body ?? null);

  const fetchPost = () =>
    postChatWithRetry(
      (attemptSignal) =>
        baseFetch(input, {
          ...init,
          signal: attemptSignal,
        }),
      {
      signal,
      onRetry: ({ attempt, delayMs, reason }) => {
        banner.setPostRetrying({ attempt, delayMs, reason });
      },
    });

  const fetchResume = () => {
    const api = resumeUrl(`/api/chat/streams/${streamId}`, streamId);
    return baseFetch(api, {
      method: 'GET',
      headers: resumeHeaders(streamId),
      credentials: init?.credentials,
      signal,
    });
  };

  while (Date.now() - reconnectStartTime < RECONNECT_GIVE_UP_MS) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    try {
      const response =
        reconnectAttempts > 0 && streamId ? await fetchResume() : await fetchPost();

      if (response.ok) {
        banner.clearTransientBanner();
      }

      if (isPermanentHttpStatus(response.status)) return response;

      if (!isPostSuccess(response.status) && response.status !== 200) {
        if (
          response.status >= 400 &&
          response.status < 500 &&
          response.status !== 429
        ) {
          return response;
        }
        await throwChatHttpError('chat', response);
      }

      if (!response.body) throw new Error('empty_response_body');

      const headerId = response.headers.get(RESUMABLE_STREAM_ID_HEADER);
      if (headerId) {
        streamId = headerId;
        resumableStorage.setStreamId(headerId);
        if (requestThreadId) setActiveChatRun(requestThreadId, headerId);
      }

      if (reconnectAttempts > 0) banner.clearReconnecting();

      const elapsedMs = Date.now() - reconnectStartTime;
      const outerStream = createAutoResumeStream({
        signal,
        streamId,
        initialBody: response.body,
        decoder,
        getAccumulator: () => accumulator,
        setAccumulator: (v) => {
          accumulator = v;
        },
        getFinishedSeen: () => finishedSeen,
        setFinishedSeen: (v) => {
          finishedSeen = v;
        },
        onLivenessTimeout: () => {
          banner.setReconnecting({
            attempt: reconnectAttempts + 1,
            delayMs: 0,
            elapsedMs,
            reason: 'liveness_timeout',
          });
        },
        resume: async () => {
          reconnectAttempts += 1;
          const delayMs = getStreamReconnectDelay(reconnectAttempts);
          banner.setReconnecting({
            attempt: reconnectAttempts,
            delayMs,
            elapsedMs: Date.now() - reconnectStartTime,
            reason: 'stream_reconnect',
          });
          await sleepMs(delayMs, signal);
          const resumed = await fetchResume();
          if (isResumableStreamGone(resumed.status)) {
            resumableStorage.clear();
            clearActiveChatRun(streamId || undefined);
            banner.clearTransientBanner();
            return null;
          }
          if (!resumed.ok) {
            await throwChatHttpError('resume', resumed);
          }
          if (!resumed.body) {
            throw new Error('empty_response_body');
          }
          return resumed.body;
        },
        onFinished: () => {
          finishedSeen = true;
          resumableStorage.clear();
          clearActiveChatRun(streamId || undefined);
          banner.clearTransientBanner();
        },
      });

      return new Response(outerStream, {
        status: 200,
        headers: response.headers,
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (!streamId) throw error;

      reconnectAttempts += 1;
      const elapsedMs = Date.now() - reconnectStartTime;
      if (elapsedMs >= RECONNECT_GIVE_UP_MS) break;

      const delayMs = getStreamReconnectDelay(reconnectAttempts);
      banner.setReconnecting({
        attempt: reconnectAttempts,
        delayMs,
        elapsedMs,
        reason: error instanceof Error ? error.message : 'connection_error',
      });
      await sleepMs(delayMs, signal);
    }
  }

  banner.setConnectionError(i18n.t('chatError.reconnectFailed.title'), i18n.t('chatError.reconnectExhausted'));
  throw new Error('chat reconnect time budget exhausted');
}

type AutoResumeStreamOptions = {
  signal?: AbortSignal | null;
  streamId: string;
  initialBody: ReadableStream<Uint8Array>;
  decoder: TextDecoder;
  getAccumulator: () => string;
  setAccumulator: (value: string) => void;
  getFinishedSeen: () => boolean;
  setFinishedSeen: (value: boolean) => void;
  onLivenessTimeout: () => void;
  resume: () => Promise<ReadableStream<Uint8Array> | null>;
  onFinished: () => void;
};

function createAutoResumeStream(
  options: AutoResumeStreamOptions,
): ReadableStream<Uint8Array> {
  let currentBody = options.initialBody;
  let closed = false;

  const pump = async (controller: ReadableStreamDefaultController<Uint8Array>) => {
    while (!closed) {
      const live = wrapTrackedStream(currentBody, {
        signal: options.signal,
        streamId: options.streamId,
        onLivenessTimeout: options.onLivenessTimeout,
      });
      const reader = live.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const acc = options.getAccumulator() + options.decoder.decode(value, { stream: true });
          if (hasStreamFinished(acc) || acc.includes('data: [DONE]')) {
            options.setFinishedSeen(true);
          }
          options.setAccumulator(acc.length > 4096 ? acc.slice(-1024) : acc);

          if (options.getFinishedSeen()) {
            closed = true;
            options.onFinished();
            controller.enqueue(value);
            controller.close();
            return;
          }

          controller.enqueue(value);
        }

        if (!options.getFinishedSeen()) {
          if (!options.streamId) {
            throw new Error('stream ended without finish');
          }
          const resumed = await options.resume();
          if (resumed === null) {
            closed = true;
            options.onFinished();
            if (!options.getFinishedSeen()) {
              dispatchChatStreamRecovery('stream_gone');
            }
            controller.close();
            return;
          }
          currentBody = resumed;
          continue;
        }

        closed = true;
        options.onFinished();
        controller.close();
        return;
      } catch (error) {
        if (isAbortError(error)) {
          controller.error(error);
          return;
        }
        if (!options.streamId) {
          controller.error(error);
          return;
        }
        try {
          const resumed = await options.resume();
          if (resumed === null) {
            closed = true;
            options.onFinished();
            if (!options.getFinishedSeen()) {
              dispatchChatStreamRecovery('stream_gone');
            }
            controller.close();
            return;
          }
          currentBody = resumed;
        } catch (resumeErr) {
          if (isBenignResumeError(resumeErr)) {
            closed = true;
            options.onFinished();
            controller.close();
            return;
          }
          controller.error(resumeErr);
          return;
        }
      } finally {
        reader.releaseLock();
      }
    }
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      void pump(controller).catch((err) => {
        try {
          controller.error(err);
        } catch {
          // controller already closed/errored
        }
      });
    },
    cancel() {
      closed = true;
    },
  });
}

function wrapTrackedStream(
  body: ReadableStream<Uint8Array>,
  options: {
    signal?: AbortSignal | null;
    streamId: string;
    onLivenessTimeout?: () => void;
  },
): ReadableStream<Uint8Array> {
  let cursor = options.streamId ? getResumeCursor(options.streamId) : '';
  let sseCarry = '';
  const live = wrapStreamWithLiveness(body, {
    signal: options.signal,
    onLivenessTimeout: options.onLivenessTimeout,
  });
  const reader = live.getReader();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      if (options.streamId) {
        // Count complete SSE frames, not TCP reads — must match store entry seq.
        const advanced = advanceCursorBySseBytes(cursor, value, sseCarry);
        cursor = advanced.cursor;
        sseCarry = advanced.carry;
        setResumeCursor(options.streamId, cursor);
      }
      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}
