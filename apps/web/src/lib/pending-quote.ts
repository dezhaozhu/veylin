const EVENT = 'veylin-pending-quote';
const MAX = 8000;

let byThread = new Map<string, string>();

export function quoteThreadIds(item: {
  id?: string | null;
  remoteId?: string | null;
  externalId?: string | null;
}): string[] {
  const ids = [item.id, item.remoteId, item.externalId];
  return [...new Set(ids.filter((id): id is string => Boolean(id?.trim())))];
}

export function getPendingQuote(threadIds: readonly string[]): string | null {
  for (const id of threadIds) {
    const hit = byThread.get(id);
    if (hit) return hit;
  }
  return null;
}

export function setPendingQuote(threadIds: readonly string[], text: string | null): void {
  const keys = [...new Set(threadIds.filter((id) => id.trim()))];
  if (keys.length === 0) return;

  const next = text?.trim() ? text.trim().slice(0, MAX) : null;
  if (!next) {
    for (const id of keys) byThread.delete(id);
  } else {
    for (const id of keys) byThread.set(id, next);
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(EVENT));
  }
}

export function clearPendingQuote(threadIds: readonly string[]): void {
  setPendingQuote(threadIds, null);
}

export function onPendingQuoteChange(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

export function resetPendingQuotesForTests(): void {
  byThread = new Map();
}
