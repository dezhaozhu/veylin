import type { AskUserResult } from '@/lib/ask-user-question-session';

export type AskUserResultSubmitter = (
  toolCallId: string,
  result: AskUserResult,
) => void | Promise<void>;

let submitter: AskUserResultSubmitter | null = null;
const submittersByThread = new Map<string, AskUserResultSubmitter>();

export function registerAskUserResultSubmitter(
  threadIdOrSubmitter: string | AskUserResultSubmitter | null,
  fn?: AskUserResultSubmitter | null,
): void {
  if (typeof threadIdOrSubmitter === 'string') {
    if (fn) {
      submittersByThread.set(threadIdOrSubmitter, fn);
    } else {
      submittersByThread.delete(threadIdOrSubmitter);
    }
    return;
  }
  submitter = threadIdOrSubmitter;
}

export async function submitAskUserResult(
  threadIdOrToolCallId: string,
  toolCallIdOrResult: string | AskUserResult,
  resultOrFallback?: AskUserResult | ((result: AskUserResult) => void),
  fallback?: (result: AskUserResult) => void,
): Promise<boolean> {
  const threadScoped = typeof toolCallIdOrResult === 'string';
  const threadId = threadScoped ? threadIdOrToolCallId : undefined;
  const toolCallId = threadScoped ? toolCallIdOrResult : threadIdOrToolCallId;
  const result = (threadScoped ? resultOrFallback : toolCallIdOrResult) as AskUserResult;
  const fallbackFn = (threadScoped ? fallback : resultOrFallback) as
    | ((result: AskUserResult) => void)
    | undefined;

  const scopedSubmitter = threadId ? submittersByThread.get(threadId) : undefined;
  if (scopedSubmitter) {
    await scopedSubmitter(toolCallId, result);
    return true;
  }
  if (submitter) {
    await submitter(toolCallId, result);
    return true;
  }
  if (fallbackFn) {
    fallbackFn(result);
    return true;
  }
  return false;
}
