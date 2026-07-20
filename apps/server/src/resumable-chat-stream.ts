import {
  createResumableStreamContext,
  createInMemoryResumableStreamStore,
  RESUMABLE_STREAM_ID_HEADER,
  type ResumableStreamContext,
  type ResumableStreamStore,
} from 'assistant-stream/resumable';
import { UI_MESSAGE_STREAM_HEADERS } from 'ai';

/** Match the agent RECONNECT_GIVE_UP_MS (10 minutes). */
const STREAM_TTL_MS = 600_000;

export { RESUMABLE_STREAM_ID_HEADER };

let store: ResumableStreamStore | null = null;
let context: ResumableStreamContext | null = null;

/** In-process abort handles for runs started on this server instance. */
const localRunAborts = new Map<string, AbortController>();

/** threadId -> { streamId, startedAt, expiresAt } */
const activeStreams = new Map<
  string,
  { streamId: string; startedAt: number; expiresAt: number }
>();

/** streamId -> expiresAt (cancelled flag) */
const cancelledStreams = new Map<string, number>();

function pruneExpired(map: Map<string, { streamId: string; expiresAt: number }>): void;
function pruneExpired(map: Map<string, number>): void;
function pruneExpired(map: Map<string, unknown>): void {
  const now = Date.now();
  for (const [key, value] of map) {
    const expiresAt =
      typeof value === 'number' ? value : (value as { expiresAt: number }).expiresAt;
    if (expiresAt <= now) map.delete(key);
  }
}

function touchActive(threadId: string, streamId: string): void {
  pruneExpired(activeStreams);
  const now = Date.now();
  activeStreams.set(threadId, {
    streamId,
    startedAt: now,
    expiresAt: now + STREAM_TTL_MS,
  });
}

function touchCancelled(streamId: string): void {
  pruneExpired(cancelledStreams);
  cancelledStreams.set(streamId, Date.now() + STREAM_TTL_MS);
}

export function countActiveLocalRuns(): number {
  return localRunAborts.size;
}

export async function waitForActiveChatDrain(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (localRunAborts.size > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export async function initResumableChatStreams(): Promise<void> {
  if (context) return;
  store = createInMemoryResumableStreamStore({
    defaultTtlMs: STREAM_TTL_MS,
  });
  context = createResumableStreamContext({ store });
}

function requireContext(): {
  context: ResumableStreamContext;
  store: ResumableStreamStore;
} {
  if (!context || !store) {
    throw new Error('Resumable chat streams not initialized; call initResumableChatStreams()');
  }
  return { context, store };
}

export async function bindActiveStream(
  threadId: string,
  streamId: string,
): Promise<void> {
  pruneExpired(activeStreams);
  const prev = activeStreams.get(threadId);
  if (prev && prev.streamId !== streamId) {
    const { context: ctx } = requireContext();
    await ctx.delete(prev.streamId).catch(() => undefined);
    cancelledStreams.delete(prev.streamId);
  }
  touchActive(threadId, streamId);
}

export async function clearActiveStream(threadId: string): Promise<void> {
  activeStreams.delete(threadId);
}

export async function getActiveStreamId(
  threadId: string,
): Promise<string | null> {
  pruneExpired(activeStreams);
  return activeStreams.get(threadId)?.streamId ?? null;
}

/**
 * Like getActiveStreamId, but drops mappings whose resumable buffer is no longer
 * actively streaming (done / error / missing). Used by the sidebar activity poll
 * so a refresh mid-run does not leave "running" for the full STREAM_TTL.
 */
export async function getLiveActiveStream(
  threadId: string,
): Promise<{ streamId: string; startedAt: number } | null> {
  pruneExpired(activeStreams);
  const entry = activeStreams.get(threadId);
  if (!entry) return null;
  try {
    const { context: ctx } = requireContext();
    const status = await ctx.status(entry.streamId);
    if (status === 'streaming') {
      return { streamId: entry.streamId, startedAt: entry.startedAt };
    }
    activeStreams.delete(threadId);
    return null;
  } catch {
    // Context not ready — keep the mapping rather than falsely clearing.
    return { streamId: entry.streamId, startedAt: entry.startedAt };
  }
}

export async function markStreamCancelled(streamId: string): Promise<void> {
  touchCancelled(streamId);
}

export async function isStreamCancelled(streamId: string): Promise<boolean> {
  pruneExpired(cancelledStreams);
  return cancelledStreams.has(streamId);
}

export function registerRunAbort(streamId: string, controller: AbortController): void {
  localRunAborts.set(streamId, controller);
}

export function unregisterRunAbort(streamId: string): void {
  localRunAborts.delete(streamId);
}

export function createRunAbortController(streamId: string): AbortController {
  const controller = new AbortController();
  registerRunAbort(streamId, controller);
  return controller;
}

/** Tee branch → in-memory resumable store (AI SDK consumeSseStream pattern). */
export function captureSseToResumable(
  streamId: string,
  sseStream: ReadableStream<string>,
): void {
  const { context: ctx } = requireContext();
  const encoded = sseStream.pipeThrough(new TextEncoderStream());
  void ctx.run(streamId, () => encoded).catch((err) => {
    console.error('[resumable] capture failed', streamId, err);
  });
}

export function resolveResumeCursor(
  lastEventId: string | undefined,
  fromSequenceNum: string | undefined,
): string {
  if (lastEventId?.trim()) return lastEventId.trim();
  if (fromSequenceNum == null || fromSequenceNum === '') return '';
  const n = Number.parseInt(fromSequenceNum, 10);
  if (Number.isNaN(n) || n <= 0) return '';
  return n.toString(36);
}

export async function resumeStreamResponse(
  streamId: string,
  cursor: string,
): Promise<Response | null> {
  const { context: ctx, store: resumableStore } = requireContext();
  const status = await ctx.status(streamId);
  if (status === 'missing') return null;

  const body = readableFromStore(resumableStore, streamId, cursor);
  return new Response(body, {
    status: 200,
    headers: {
      ...UI_MESSAGE_STREAM_HEADERS,
      [RESUMABLE_STREAM_ID_HEADER]: streamId,
    },
  });
}

export type StopChatStreamOptions = {
  threadId: string;
  activeStreamId?: string;
};

export type StopChatStreamResult = {
  ok: true;
  stopped: boolean;
  streamId?: string;
  reason?: 'not_found' | 'stale';
};

/**
 * Explicit stop (AI SDK resumable streams): cancel producer, finalize buffer,
 * clear active stream mapping. Safe if stream already finished.
 */
export async function stopChatStream(
  options: StopChatStreamOptions,
): Promise<StopChatStreamResult> {
  const { threadId, activeStreamId } = options;
  const current = await getActiveStreamId(threadId);
  const streamId = activeStreamId ?? current;

  if (!streamId) {
    return { ok: true, stopped: false, reason: 'not_found' };
  }

  if (current && current !== streamId) {
    return { ok: true, stopped: false, reason: 'stale', streamId };
  }

  await markStreamCancelled(streamId);
  localRunAborts.get(streamId)?.abort();
  localRunAborts.delete(streamId);

  const { context: ctx, store: resumableStore } = requireContext();
  try {
    const status = await ctx.status(streamId);
    // Finalize as done so resume readers close cleanly (error finalize throws and can crash the process).
    if (status === 'streaming') {
      await resumableStore.finalize(streamId, 'done');
    }
  } catch {
    /* stream may already be gone */
  }

  await clearActiveStream(threadId);
  cancelledStreams.delete(streamId);

  return { ok: true, stopped: true, streamId };
}

function readableFromStore(
  resumableStore: ResumableStreamStore,
  streamId: string,
  cursor: string,
): ReadableStream<Uint8Array> {
  const ac = new AbortController();
  let iterator: AsyncIterator<{ chunk: Uint8Array }> | undefined;

  return new ReadableStream<Uint8Array>({
    start() {
      iterator = resumableStore.read(streamId, cursor, ac.signal)[
        Symbol.asyncIterator
      ]();
    },
    async pull(controller) {
      try {
        if (!iterator) return;
        const { done, value } = await iterator.next();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(value.chunk);
      } catch (err) {
        ac.abort();
        try {
          await iterator?.return?.();
        } catch {
          /* ignore */
        }
        if (err instanceof Error && err.message === 'stopped by user') {
          controller.close();
          return;
        }
        controller.error(err);
      }
    },
    cancel() {
      ac.abort();
      void iterator?.return?.();
    },
  });
}

export function mergeResumableStreamHeaders(
  base: Record<string, string> | Headers,
  streamId: string,
): Record<string, string> {
  const merged = new Headers(base);
  merged.set(RESUMABLE_STREAM_ID_HEADER, streamId);
  return Object.fromEntries(merged);
}
