import type { UIMessage } from 'ai';
import {
  findFirstAwaitingFrontendToolIndex,
  pendingFrontendToolCallId,
} from '@/lib/frontend-suspend-tools';
import { normalizeAskQuestions } from '@/lib/ask-user-question-normalize';
import { setAskUserSession } from '@/lib/ask-user-question-session';
import { submitAskUserResult } from '@/lib/ask-user-submit-bridge';

type AskToolPart = {
  type?: string;
  toolCallId?: string;
  input?: { questions?: unknown[] };
  args?: { questions?: unknown[] };
};

/** Re-open the composer ask panel for a persisted pending tool after history load. */
export function restorePendingAskUserSession(
  threadId: string | undefined,
  messages: readonly UIMessage[],
): void {
  if (!threadId) return;

  const last = messages.at(-1);
  if (last?.role !== 'assistant' || !last.parts?.length) return;

  const pendingIndex = findFirstAwaitingFrontendToolIndex(last.parts);
  if (pendingIndex < 0) return;

  const part = last.parts[pendingIndex] as AskToolPart;
  if (part.type !== 'tool-ask_user_question') return;

  const questions = normalizeAskQuestions(
    part.input?.questions ?? part.args?.questions ?? [],
  );
  if (questions.length === 0) return;

  const toolCallId = pendingFrontendToolCallId(last, pendingIndex, part);

  setAskUserSession({
    threadId,
    toolCallId,
    questions,
    addResult: (result) => {
      void submitAskUserResult(threadId, toolCallId, result);
    },
  });
}
