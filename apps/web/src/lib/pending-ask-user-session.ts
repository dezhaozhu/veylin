import { pendingFrontendToolCallId } from '@/lib/frontend-suspend-tools';
import { normalizeAskQuestions } from '@/lib/ask-user-question-normalize';
import {
  getAskUserSessionForThread,
  setAskUserSession,
} from '@/lib/ask-user-question-session';
import { submitAskUserResult } from '@/lib/ask-user-submit-bridge';

type AskToolPart = {
  type?: string;
  toolCallId?: string;
  input?: { questions?: unknown[] };
  args?: { questions?: unknown[] };
};

/**
 * Open the composer ask panel for a pending ask tool call.
 *
 * Driven by message state rather than by the inline tool UI: that component
 * lives inside the collapsible "Worked for" shell, which unmounts its children
 * while closed, so a render-time registration would leave the panel invisible.
 */
export function registerPendingAskUserSession(
  threadId: string,
  message: { id: string; parts?: unknown[] },
  pendingIndex: number,
  part: AskToolPart,
): boolean {
  if (part.type !== 'tool-ask_user_question') return false;

  const questions = normalizeAskQuestions(
    part.input?.questions ?? part.args?.questions ?? [],
  );
  if (questions.length === 0) return false;

  const toolCallId = pendingFrontendToolCallId(message, pendingIndex, part);
  const current = getAskUserSessionForThread(threadId);
  if (current?.toolCallId === toolCallId) return true;

  setAskUserSession({
    threadId,
    toolCallId,
    questions,
    addResult: (result) => {
      void submitAskUserResult(threadId, toolCallId, result);
    },
  });
  return true;
}
