import type { UIMessage } from 'ai';
import { isToolUIPart } from 'ai';
import { shouldAutoSendChat } from './frontend-suspend-tools';

/** Dedupes auto-continuation so the same assistant/tool state only schedules one POST. */
export type ToolContinuationAttemptTracker = {
  lastFingerprint: string | null;
};

export function createToolContinuationAttemptTracker(): ToolContinuationAttemptTracker {
  return { lastFingerprint: null };
}

export function resetToolContinuationAttemptTracker(
  tracker: ToolContinuationAttemptTracker,
): void {
  tracker.lastFingerprint = null;
}

/** Stable key for the last assistant message's tool/reply state. */
export function toolContinuationFingerprint(messages: UIMessage[]): string | null {
  const last = messages.at(-1);
  if (last?.role !== 'assistant' || !last.parts?.length) return null;

  const segments = last.parts.map((part) => {
    if (!part || typeof part !== 'object') return 'u';
    const p = part as { type?: string; state?: string; toolCallId?: string; text?: string };
    if (p.type === 'text') return `t:${p.text?.trim().length ?? 0}`;
    if (p.type === 'step-start') return 'step';
    if (isToolUIPart(part as never)) {
      return `tool:${p.toolCallId ?? p.type}:${p.state ?? '?'}`;
    }
    return p.type ?? '?';
  });

  return `${last.id}|${segments.join(';')}`;
}

export function markToolContinuationAttempt(
  tracker: ToolContinuationAttemptTracker,
  fingerprint: string,
): boolean {
  if (tracker.lastFingerprint === fingerprint) return false;
  tracker.lastFingerprint = fingerprint;
  return true;
}

/** Undo fingerprint consumption when continuation scheduling was rejected. */
export function unmarkToolContinuationAttempt(
  tracker: ToolContinuationAttemptTracker,
  fingerprint: string,
): void {
  if (tracker.lastFingerprint === fingerprint) {
    tracker.lastFingerprint = null;
  }
}

export type ChatRunStatus = 'submitted' | 'streaming' | 'ready' | 'error' | string;

const CONTINUE_RETRY_MS = 32;

export type FrontendToolContinuationController = {
  pending: boolean;
  continuing: boolean;
  waitAttempts: number;
  stopRequested: boolean;
  sendStarted: boolean;
};

export function createFrontendToolContinuationController(): FrontendToolContinuationController {
  return {
    pending: false,
    continuing: false,
    waitAttempts: 0,
    stopRequested: false,
    sendStarted: false,
  };
}

/** Clear pending auto-continuation after the user explicitly cancels a run. */
export function resetFrontendToolContinuationController(
  controller: FrontendToolContinuationController,
): void {
  controller.pending = false;
  controller.continuing = false;
  controller.waitAttempts = 0;
  controller.stopRequested = false;
  controller.sendStarted = false;
}

export type ContinueFrontendToolChatArgs = {
  controller: FrontendToolContinuationController;
  getStatus: () => ChatRunStatus;
  getMessages: () => UIMessage[];
  stopStream: () => void;
  ensureStopped?: () => void | Promise<void>;
  sendMessage: () => void | Promise<void>;
  /** Clears dedupe so a failed continuation can be retried on the next ready tick. */
  onSendFailed?: () => void;
};

function scheduleContinueRetry(args: ContinueFrontendToolChatArgs): void {
  globalThis.setTimeout(() => {
    void tryContinueFrontendToolChat(args);
  }, CONTINUE_RETRY_MS);
}

/**
 * Resume after a client-completed suspend tool or provider-executed server tool.
 * Production disables AI SDK sendAutomaticallyWhen; this is the sole continuation path.
 */
export async function tryContinueFrontendToolChat(
  args: ContinueFrontendToolChatArgs,
): Promise<void> {
  if (args.controller.continuing || !args.controller.pending) return;
  if (args.controller.sendStarted) {
    args.controller.pending = false;
    return;
  }

  args.controller.continuing = true;
  try {
    if (!args.controller.pending) return;

    const messages = args.getMessages();
    if (!shouldAutoSendChat({ messages, status: args.getStatus() })) {
      args.controller.pending = false;
      args.controller.waitAttempts = 0;
      args.controller.stopRequested = false;
      args.controller.sendStarted = false;
      return;
    }

    const status = args.getStatus();

    if (status === 'streaming' || status === 'submitted') {
      if (!args.controller.stopRequested) {
        args.controller.stopRequested = true;
        if (args.ensureStopped) {
          await args.ensureStopped();
        } else {
          args.stopStream();
        }
      }
    }

    args.controller.sendStarted = true;
    args.controller.pending = false;
    args.controller.waitAttempts = 0;
    args.controller.stopRequested = false;
    await args.sendMessage();
  } catch {
    args.controller.sendStarted = false;
    args.controller.pending = true;
    args.onSendFailed?.();
  } finally {
    args.controller.continuing = false;
    if (args.controller.pending) {
      scheduleContinueRetry(args);
    }
  }
}

export function requestFrontendToolContinuation(
  controller: FrontendToolContinuationController,
  run: () => void,
): boolean {
  if (controller.continuing || controller.pending || controller.sendStarted) {
    return false;
  }
  controller.pending = true;
  controller.sendStarted = false;
  run();
  return true;
}
