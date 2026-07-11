import type { ThreadLoopState } from '@veylin/shared';
import { getThreadState, setThreadLoop } from './thread-state.js';

type WakeHandler = (threadId: string, loop: ThreadLoopState) => void | Promise<void>;

const timers = new Map<string, ReturnType<typeof setTimeout>>();
let wakeHandler: WakeHandler | null = null;

/** Register how loop wakeups deliver a turn (usually client-notified via state; optional server hook). */
export function setLoopWakeHandler(handler: WakeHandler | null): void {
  wakeHandler = handler;
}

export function clearLoopTimer(threadId: string): void {
  const t = timers.get(threadId);
  if (t) clearTimeout(t);
  timers.delete(threadId);
}

export function scheduleLoopWake(threadId: string, loop: ThreadLoopState): void {
  clearLoopTimer(threadId);
  if (loop.status !== 'active' || !loop.nextWakeAt) return;

  const created = Date.parse(loop.createdAt);
  const maxAgeMs = (loop.maxAgeDays ?? 7) * 86400_000;
  if (Number.isFinite(created) && Date.now() - created > maxAgeMs) {
    void setThreadLoop(threadId, { ...loop, status: 'stopped', nextWakeAt: undefined });
    return;
  }

  const when = Date.parse(loop.nextWakeAt);
  if (!Number.isFinite(when)) return;
  const delay = Math.max(0, when - Date.now());

  const timer = setTimeout(() => {
    timers.delete(threadId);
    void (async () => {
      const state = await getThreadState(threadId);
      const current = state?.loop;
      if (!current || current.status !== 'active' || current.jobId !== loop.jobId) return;
      if (wakeHandler) await wakeHandler(threadId, current);
      // Mark due for client bridge if no handler consumed it.
      await setThreadLoop(threadId, {
        ...current,
        nextWakeAt: new Date().toISOString(),
      });
    })();
  }, delay);

  timers.set(threadId, timer);
}

export function rescheduleLoopFromState(threadId: string, loop: ThreadLoopState | null): void {
  clearLoopTimer(threadId);
  if (loop?.status === 'active' && loop.nextWakeAt) {
    scheduleLoopWake(threadId, loop);
  }
}
