import type { UIMessage } from 'ai';

type SyncThreadMessagesBody = {
  messages: UIMessage[];
  forceReplace?: boolean;
};

export function isPersistableThreadId(threadId: string | undefined): boolean {
  if (!threadId) return false;
  return !threadId.startsWith('__LOCALID');
}

export async function syncThreadMessagesToServer(
  threadId: string,
  messages: UIMessage[],
  options: { forceReplace?: boolean } = {},
): Promise<void> {
  if (!isPersistableThreadId(threadId) || messages.length === 0) return;

  const body: SyncThreadMessagesBody = {
    messages,
    ...(options.forceReplace ? { forceReplace: true } : {}),
  };

  const res = await fetch(`/api/threads/${encodeURIComponent(threadId)}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.warn('[history] sync failed', text || res.statusText);
  }
}
