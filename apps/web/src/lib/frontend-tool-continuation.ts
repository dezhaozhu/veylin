import type { UIMessage } from 'ai';
import { isToolUIPart } from 'ai';
import { isRetryableProviderChatError } from './format-chat-error';
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

/**
 * Whether the chat runtime should fire a follow-up POST to continue the run.
 * Only client-side suspend tools (ask_user_question, read_open_page,
 * request_3d_selection) and server-tool resume need this. Subagents run
 * synchronously inside the server stream now, so background-task synthesis is
 * no longer a continuation trigger.
 */
export function canAutoContinueChat(
  messages: UIMessage[],
  status: string,
): boolean {
  return shouldAutoSendChat({ messages, status });
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

const CONTINUE_RETRY_MS = 250;
const PROVIDER_RETRY_MS = 2_000;
/** Cap retries so a persistently failing sendMessage can never storm the main thread. */
export const MAX_CONTINUE_FAILURES = 5;

export type FrontendToolContinuationController = {
  pending: boolean;
  continuing: boolean;
  waitAttempts: number;
  stopRequested: boolean;
  sendStarted: boolean;
  /** Consecutive sendMessage failures; bounded by MAX_CONTINUE_FAILURES. */
  failureAttempts: number;
};

export function createFrontendToolContinuationController(): FrontendToolContinuationController {
  return {
    pending: false,
    continuing: false,
    waitAttempts: 0,
    stopRequested: false,
    sendStarted: false,
    failureAttempts: 0,
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
  controller.failureAttempts = 0;
}

export type ContinueFrontendToolChatArgs = {
  controller: FrontendToolContinuationController;
  getStatus: () => ChatRunStatus;
  getMessages: () => UIMessage[];
  stopStream: () => void;
  ensureStopped?: () => void | Promise<void>;
  sendMessage: () => void | Promise<void>;
  /** Clears the last chat error before a retry attempt. */
  clearError?: () => void;
  /** Clears dedupe so a failed continuation can be retried on the next ready tick. */
  onSendFailed?: () => void;
  lastError?: { current: unknown };
};

function scheduleContinueRetry(args: ContinueFrontendToolChatArgs, delayMs = CONTINUE_RETRY_MS): void {
  globalThis.setTimeout(() => {
    void tryContinueFrontendToolChat(args);
  }, delayMs);
}

/**
 * Resume after a client-completed suspend tool or server tool.
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
    if (!canAutoContinueChat(messages, args.getStatus())) {
      args.controller.pending = false;
      args.controller.waitAttempts = 0;
      args.controller.stopRequested = false;
      args.controller.sendStarted = false;
      args.controller.failureAttempts = 0;
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
    args.clearError?.();
    await args.sendMessage();
    args.controller.failureAttempts = 0;
  } catch (error) {
    if (args.lastError) args.lastError.current = error;
    args.controller.sendStarted = false;
    args.controller.failureAttempts += 1;
    // Give up after a bounded number of failures so retries can't busy-loop the
    // main thread; the user can resend or the stuck-stream recovery will step in.
    args.controller.pending =
      args.controller.failureAttempts < MAX_CONTINUE_FAILURES;
    args.onSendFailed?.();
  } finally {
    args.controller.continuing = false;
    if (args.controller.pending) {
      const baseDelay = isRetryableProviderChatError(args.lastError?.current)
        ? PROVIDER_RETRY_MS
        : CONTINUE_RETRY_MS;
      // Exponential backoff on consecutive failures (capped at ~4s).
      const backoff = Math.min(
        baseDelay * 2 ** Math.max(0, args.controller.failureAttempts - 1),
        4_000,
      );
      scheduleContinueRetry(args, backoff);
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
