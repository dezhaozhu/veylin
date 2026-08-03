import {
  clearAskUserSession,
  setAskUserSession,
  type AskQuestion,
  type AskUserResult,
} from '@/lib/ask-user-question-session';
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
      setAskUserSession({
        threadId: currentThreadId,
        toolCallId: 'dev-e2e-ask',
        questions,
        addResult: (result) => {
          lastAskResult = result;
          clearAskUserSession(currentThreadId!, 'dev-e2e-ask');
        },
      });
    },
    peekAskResult: () => lastAskResult,
    clearAskResult: () => {
      lastAskResult = null;
    },
  };
}
