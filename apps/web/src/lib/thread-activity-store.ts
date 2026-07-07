export type ThreadActivityKind = 'running' | 'finished' | 'interrupted';

export type ThreadActivity = {
  kind: ThreadActivityKind;
  at: string;
};

const ACTIVE_POLL_MS = 3_000;
const IDLE_POLL_MS = 15_000;

type ActivityResponse = { activity: Record<string, ThreadActivity> };

let activity: Record<string, ThreadActivity> = {};
let subscriberCount = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let inFlight = false;
const listeners = new Set<() => void>();

function hasRunningActivity(map: Record<string, ThreadActivity>): boolean {
  return Object.values(map).some((entry) => entry.kind === 'running');
}

function pollIntervalMs(map: Record<string, ThreadActivity>): number {
  return hasRunningActivity(map) ? ACTIVE_POLL_MS : IDLE_POLL_MS;
}

function notify(): void {
  for (const listener of listeners) listener();
}

async function fetchActivity(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const res = await fetch('/api/threads/activity', { credentials: 'include' });
    if (!res.ok) return;
    const data = (await res.json()) as ActivityResponse;
    activity = data.activity ?? {};
    notify();
  } catch {
    /* best-effort */
  } finally {
    inFlight = false;
  }
}

function schedulePoll(delayMs: number): void {
  if (timer) clearTimeout(timer);
  if (subscriberCount <= 0) return;
  timer = setTimeout(() => {
    void fetchActivity().finally(() => {
      schedulePoll(pollIntervalMs(activity));
    });
  }, delayMs);
}

function startPoller(): void {
  schedulePoll(0);
}

function stopPoller(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
}

export function getThreadActivityMap(): Record<string, ThreadActivity> {
  return activity;
}

export function subscribeThreadActivity(listener: () => void): () => void {
  listeners.add(listener);
  subscriberCount += 1;
  if (subscriberCount === 1) startPoller();
  return () => {
    listeners.delete(listener);
    subscriberCount = Math.max(0, subscriberCount - 1);
    if (subscriberCount === 0) stopPoller();
  };
}

export function resetThreadActivityStoreForTests(): void {
  activity = {};
  subscriberCount = 0;
  stopPoller();
  inFlight = false;
  listeners.clear();
}
