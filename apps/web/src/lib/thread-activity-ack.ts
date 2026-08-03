const KEY = 'veylin-thread-activity-ack';

type AckMap = Record<string, string>;

function readMap(): AckMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as AckMap) : {};
  } catch {
    return {};
  }
}

function writeMap(map: AckMap): void {
  localStorage.setItem(KEY, JSON.stringify(map));
}

export function ackThreadActivity(threadId: string, at?: string): void {
  if (!threadId) return;
  const map = readMap();
  map[threadId] = at ?? new Date().toISOString();
  writeMap(map);
  notifyThreadActivityAckChange();
}

/** Whether the sidebar should show an activity badge for this thread. */
export function shouldShowThreadActivityBadge(
  threadId: string,
  activity: { kind: string; at: string } | undefined,
): boolean {
  if (!activity) return false;
  if (activity.kind === 'running') return true;
  const ackedAt = readMap()[threadId];
  if (!ackedAt) return true;
  return new Date(activity.at).getTime() > new Date(ackedAt).getTime();
}

export function onThreadActivityAckChange(cb: () => void): () => void {
  const onStorage = (e: Event) => {
    if ((e as StorageEvent).key === KEY || (e as StorageEvent).key === null) cb();
  };
  const onAck = () => cb();
  window.addEventListener('storage', onStorage);
  window.addEventListener('veylin-thread-activity-ack', onAck);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('veylin-thread-activity-ack', onAck);
  };
}

export function notifyThreadActivityAckChange(): void {
  window.dispatchEvent(new Event('veylin-thread-activity-ack'));
}
