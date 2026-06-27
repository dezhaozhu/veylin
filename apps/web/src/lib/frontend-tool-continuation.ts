import type { UIMessage } from 'ai';
import { shouldAutoSendChat } from './frontend-suspend-tools';

export type ChatRunStatus = 'submitted' | 'streaming' | 'ready' | 'error' | string;

export type FrontendToolContinuationController = {
  pending: boolean;
  continuing: boolean;
};

export function createFrontendToolContinuationController(): FrontendToolContinuationController {
  return { pending: false, continuing: false };
}

export type ContinueFrontendToolChatArgs = {
  controller: FrontendToolContinuationController;
  getStatus: () => ChatRunStatus;
  getMessages: () => UIMessage[];
  stopStream: () => void;
  sendMessage: () => void | Promise<void>;
};

/**
 * Resume after a client-completed suspend tool (ask_user_question / read_open_page).
 * AI SDK skips auto-send while status is streaming/submitted; this bridges that gap
 * without blocking the UI on fixed timeouts.
 */
export async function tryContinueFrontendToolChat(
  args: ContinueFrontendToolChatArgs,
): Promise<void> {
  if (args.controller.continuing || !args.controller.pending) return;

  args.controller.continuing = true;
  try {
    if (!args.controller.pending) return;

    const messages = args.getMessages();
    if (!shouldAutoSendChat({ messages })) {
      args.controller.pending = false;
      return;
    }

    const status = args.getStatus();
    if (status === 'submitted') {
      // Continuation POST already in flight — do not stop it.
      args.controller.pending = false;
      return;
    }
    if (status === 'streaming') {
      args.stopStream();
      return;
    }

    args.controller.pending = false;
    await args.sendMessage();
  } finally {
    args.controller.continuing = false;
    if (args.controller.pending) {
      queueMicrotask(() => {
        void tryContinueFrontendToolChat(args);
      });
    }
  }
}

export function requestFrontendToolContinuation(
  controller: FrontendToolContinuationController,
  run: () => void,
): void {
  controller.pending = true;
  run();
}
