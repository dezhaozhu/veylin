import {
  clearAskUserSession,
  setAskUserSession,
  type AskQuestion,
  type AskUserResult,
} from '@/lib/ask-user-question-session';
import { registerAskUserResultSubmitter } from '@/lib/ask-user-submit-bridge';
import { recoverDesktopInteraction } from '@/lib/use-desktop-interaction-guard';

let currentThreadId: string | undefined;
let lastAskResult: AskUserResult | null = null;

export function registerDevThreadId(threadId: string): void {
  currentThreadId = threadId;
}

export function installDevTestHooks(): void {
  if (!import.meta.env.DEV) return;

  const win = window as Window & {
    __veylinTest?: {
      hasThread: () => boolean;
      openAskPanel: (questions: AskQuestion[]) => void;
      peekAskResult: () => AskUserResult | null;
      clearAskResult: () => void;
    };
    __veylinRecoverInteraction?: () => void;
  };

  win.__veylinRecoverInteraction = recoverDesktopInteraction;

  win.__veylinTest = {
    hasThread: () => Boolean(currentThreadId),
    openAskPanel(questions) {
      if (!currentThreadId) {
        throw new Error('dev ask panel: thread id not ready');
      }
      lastAskResult = null;
      const threadId = currentThreadId;
      // Mirror production: panel submit goes through the thread-scoped bridge.
      registerAskUserResultSubmitter(threadId, async (_toolCallId, result) => {
        lastAskResult = result;
        clearAskUserSession(threadId, 'dev-e2e-ask');
        registerAskUserResultSubmitter(threadId, null);
      });
      setAskUserSession({
        threadId,
        toolCallId: 'dev-e2e-ask',
        questions,
        addResult: (result) => {
          lastAskResult = result;
          clearAskUserSession(threadId, 'dev-e2e-ask');
          registerAskUserResultSubmitter(threadId, null);
        },
      });
    },
    peekAskResult: () => lastAskResult,
    clearAskResult: () => {
      lastAskResult = null;
    },
  };
}
