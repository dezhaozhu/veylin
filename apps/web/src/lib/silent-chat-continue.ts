/** Runtime hook for starting a chat turn without appending a user message. */

type SilentContinueFn = () => Promise<void>;

let silentContinue: SilentContinueFn | null = null;

export function setSilentChatContinue(fn: SilentContinueFn | null): void {
  silentContinue = fn;
}

/** Returns false when no chat runtime is mounted. */
export async function requestSilentChatContinue(): Promise<boolean> {
  if (!silentContinue) return false;
  await silentContinue();
  return true;
}
