import type { UIMessage } from 'ai';
import { needsFrontendSuspendContinuation } from './frontend-suspend-tools';

export const CHAT_STREAM_RECOVERY_EVENT = 'veylin:chat-stream-recovery';

export type ChatStreamRecoveryReason = 'stream_gone' | 'stream_incomplete';

export function dispatchChatStreamRecovery(reason: ChatStreamRecoveryReason): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(CHAT_STREAM_RECOVERY_EVENT, { detail: { reason } }),
  );
}

/**
 * Running UI with a completed client-side suspend/server tool but no server reply —
 * the follow-up continuation POST should fire when the run settles. Subagents now run
 * inside the server stream, so a streaming coordinator turn is never "stuck".
 */
export function isStuckAwaitingToolContinuation(
  messages: UIMessage[],
  status: string | undefined,
): boolean {
  if (status !== 'streaming' && status !== 'submitted') return false;
  // Only a completed client-side suspend tool can wedge a still-streaming run.
  // In-progress server tools (subagent `task`, web_fetch) legitimately hold the
  // stream open while they execute, so they must NOT be force-recovered — doing
  // so aborts the live run and cancels the running subagent.
  return needsFrontendSuspendContinuation(messages);
}
