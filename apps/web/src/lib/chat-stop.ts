import { clearResumeCursor } from '@/lib/stream-resume-cursor';
import { resumableStorage } from '@/lib/resumable-storage';

export type StopChatRequest = {
  activeStreamId?: string | null;
};

export async function requestChatStop(
  threadId: string,
  body: StopChatRequest = {},
): Promise<{ ok: boolean; stopped?: boolean }> {
  const streamId = body.activeStreamId ?? resumableStorage.getStreamId();
  const res = await fetch(`/api/chat/${encodeURIComponent(threadId)}/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      activeStreamId: streamId ?? undefined,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text.trim() || `stop failed: HTTP ${res.status}`);
  }

  const data = (await res.json()) as { ok?: boolean; stopped?: boolean };
  resumableStorage.clear();
  if (streamId) clearResumeCursor(streamId);
  return { ok: data.ok ?? true, stopped: data.stopped };
}
