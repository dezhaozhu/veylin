import { requestChatStop } from '@/lib/chat-stop';
import { resumableStorage } from '@/lib/resumable-storage';

/** Stop active generation and clear resumable stream state before rewind/edit. */
export async function prepareThreadRewind(
  threadId: string | undefined,
  opts?: { isRunning?: boolean; stop?: () => void },
): Promise<void> {
  if (threadId) {
    try {
      await requestChatStop(threadId);
    } catch {
      // Best-effort; client stop still runs below.
    }
  } else {
    resumableStorage.clear();
  }

  if (opts?.isRunning) {
    opts.stop?.();
  }
}
