import { clearResumeCursor } from '@/lib/stream-resume-cursor';
import { resumableStorage } from '@/lib/resumable-storage';
import {
  clearActiveChatRun,
  getActiveChatRun,
} from '@/lib/active-chat-run';

export type StopChatRequest = {
  activeStreamId?: string | null;
  /** Survive document unload (refresh / tab close). Skips response parsing. */
  keepalive?: boolean;
};

export async function requestChatStop(
  threadId: string,
  body: StopChatRequest = {},
): Promise<{ ok: boolean; stopped?: boolean }> {
  const streamId =
    body.activeStreamId ??
    resumableStorage.getStreamId() ??
    getActiveChatRun()?.streamId ??
    null;
  const payload = JSON.stringify({
    activeStreamId: streamId ?? undefined,
  });
  const res = await fetch(`/api/chat/${encodeURIComponent(threadId)}/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: payload,
    ...(body.keepalive ? { keepalive: true } : {}),
  });

  if (body.keepalive) {
    // Unload path: do not await JSON; best-effort clear local resume state.
    resumableStorage.clear();
    clearActiveChatRun(streamId ?? undefined);
    if (streamId) clearResumeCursor(streamId);
    return { ok: res.ok, stopped: res.ok };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text.trim() || `stop failed: HTTP ${res.status}`);
  }

  const data = (await res.json()) as { ok?: boolean; stopped?: boolean };
  resumableStorage.clear();
  clearActiveChatRun(streamId ?? undefined);
  if (streamId) clearResumeCursor(streamId);
  return { ok: data.ok ?? true, stopped: data.stopped };
}

/** Best-effort stop for Cmd+R / unload when React thread id is unavailable. */
export function stopActiveChatKeepalive(): void {
  const run = getActiveChatRun();
  const streamId = run?.streamId ?? resumableStorage.getStreamId();
  const threadId = run?.threadId;
  if (!threadId || !streamId) return;
  void requestChatStop(threadId, { activeStreamId: streamId, keepalive: true });
}
