import type { ThreadGoalState, ThreadLoopState } from '@veylin/shared';
import { isPersistableThreadId } from './sync-thread-messages';

const goalByThread = new Map<string, ThreadGoalState | null>();
const loopByThread = new Map<string, ThreadLoopState | null>();
const listeners = new Set<() => void>();
/** Suppress stale fetches while a clear is in flight. */
const goalClearInFlight = new Set<string>();

function emit(): void {
  for (const l of listeners) l();
}

export function onGoalLoopChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function readCachedGoal(threadId: string): ThreadGoalState | null | undefined {
  return goalByThread.has(threadId) ? goalByThread.get(threadId) : undefined;
}

export function readCachedLoop(threadId: string): ThreadLoopState | null | undefined {
  return loopByThread.has(threadId) ? loopByThread.get(threadId) : undefined;
}

export function writeCachedGoal(threadId: string, goal: ThreadGoalState | null): void {
  goalByThread.set(threadId, goal);
  emit();
}

export function writeCachedLoop(threadId: string, loop: ThreadLoopState | null): void {
  loopByThread.set(threadId, loop);
  emit();
}

export async function fetchThreadGoal(threadId: string): Promise<ThreadGoalState | null> {
  if (!isPersistableThreadId(threadId)) return null;
  if (goalClearInFlight.has(threadId)) {
    return readCachedGoal(threadId) ?? null;
  }
  const res = await fetch(`/api/goal?threadId=${encodeURIComponent(threadId)}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { goal?: ThreadGoalState | null };
  const goal = data.goal ?? null;
  if (goalClearInFlight.has(threadId)) {
    return readCachedGoal(threadId) ?? null;
  }
  writeCachedGoal(threadId, goal);
  return goal;
}

export async function fetchThreadLoop(threadId: string): Promise<ThreadLoopState | null> {
  if (!isPersistableThreadId(threadId)) return null;
  const res = await fetch(`/api/loop?threadId=${encodeURIComponent(threadId)}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { loop?: ThreadLoopState | null };
  const loop = data.loop ?? null;
  writeCachedLoop(threadId, loop);
  return loop;
}

export async function setThreadGoalApi(
  threadId: string,
  condition: string,
  maxTurns?: number,
): Promise<{ ok: boolean; goal?: ThreadGoalState | null; error?: string; message?: string }> {
  const res = await fetch('/api/goal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ threadId, action: 'set', condition, maxTurns }),
  });
  const data = (await res.json()) as {
    ok?: boolean;
    goal?: ThreadGoalState | null;
    error?: string;
    message?: string;
  };
  if (res.ok && data.goal) writeCachedGoal(threadId, data.goal);
  return { ok: res.ok, ...data };
}

export async function clearThreadGoalApi(threadId: string): Promise<void> {
  goalClearInFlight.add(threadId);
  writeCachedGoal(threadId, null);
  try {
    const res = await fetch('/api/goal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId, action: 'clear' }),
    });
    if (res.ok) {
      const data = (await res.json()) as { goal?: ThreadGoalState | null };
      writeCachedGoal(threadId, data.goal ?? null);
    }
  } finally {
    goalClearInFlight.delete(threadId);
  }
}

export async function ackGoalContinueApi(threadId: string): Promise<ThreadGoalState | null> {
  const res = await fetch('/api/goal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ threadId, action: 'ack-continue' }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { goal?: ThreadGoalState | null };
  writeCachedGoal(threadId, data.goal ?? null);
  return data.goal ?? null;
}

export async function setThreadLoopApi(
  threadId: string,
  prompt: string,
  opts?: { intervalSeconds?: number; interval?: string; mode?: 'fixed' | 'dynamic' },
): Promise<{ ok: boolean; loop?: ThreadLoopState | null; error?: string; message?: string }> {
  const res = await fetch('/api/loop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      threadId,
      action: 'set',
      prompt,
      intervalSeconds: opts?.intervalSeconds,
      interval: opts?.interval,
      mode: opts?.mode,
    }),
  });
  const data = (await res.json()) as {
    ok?: boolean;
    loop?: ThreadLoopState | null;
    error?: string;
    message?: string;
  };
  if (res.ok && data.loop) writeCachedLoop(threadId, data.loop);
  return { ok: res.ok, ...data };
}

export async function stopThreadLoopApi(threadId: string): Promise<void> {
  const res = await fetch('/api/loop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ threadId, action: 'stop' }),
  });
  if (res.ok) {
    const data = (await res.json()) as { loop?: ThreadLoopState | null };
    writeCachedLoop(threadId, data.loop ?? null);
  }
}

export async function ackLoopWakeApi(threadId: string): Promise<ThreadLoopState | null> {
  const res = await fetch('/api/loop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ threadId, action: 'ack-wake' }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { loop?: ThreadLoopState | null };
  writeCachedLoop(threadId, data.loop ?? null);
  return data.loop ?? null;
}
