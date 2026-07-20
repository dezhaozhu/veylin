/** Last in-flight main-chat run — readable from unload / Cmd+R without React. */

let active: { threadId: string; streamId: string } | null = null;

export function setActiveChatRun(threadId: string, streamId: string): void {
  if (!threadId || !streamId) return;
  active = { threadId, streamId };
}

export function getActiveChatRun(): { threadId: string; streamId: string } | null {
  return active;
}

export function clearActiveChatRun(streamId?: string): void {
  if (streamId && active && active.streamId !== streamId) return;
  active = null;
}
