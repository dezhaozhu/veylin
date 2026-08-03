"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UIMessage, useChat, CreateUIMessage } from "@ai-sdk/react";
import { isToolUIPart, generateId } from "ai";
import {
  useExternalStoreRuntime,
  useRuntimeAdapters,
  type JoinStrategy,
} from "@assistant-ui/core/react";
import type { ToolExecutionStatus } from "@assistant-ui/core";
import type {
  ExternalStoreAdapter,
  ExternalStoreSharedOptions,
  ThreadHistoryAdapter,
  AssistantRuntime,
  ThreadMessage,
  MessageFormatAdapter,
  MessageFormatItem,
  MessageFormatRepository,
  AppendMessage,
  RunConfig,
  McpAppMetadata,
} from "@assistant-ui/core";
import {
  getExternalStoreMessages,
  pickExternalStoreSharedOptions,
} from "@assistant-ui/core";
import type { ReadonlyJSONObject } from "assistant-stream/utils";
import {
  toCreateMessage,
  vercelAttachmentAdapter,
  AISDKMessageConverter,
  wrapModelContentEnvelope,
  aiSDKV6FormatAdapter,
  sliceMessagesUntil,
  useStreamingTiming,
} from '@/vendor/assistant-ui';
import type { AISDKStorageFormat } from '@/vendor/assistant-ui';
import { sliceMessagesForLinearEdit } from "./slice-messages-for-linear-edit";
import {
  useExternalHistory,
  toExportedMessageRepository,
} from './use-external-history';
import { stampInterruptedAssistant, stampMessageWithSentAt } from "./message-timestamp";
import { stampOutgoingUserMessage } from "./pending-skill-message";
import { createMessageQueueWithDrafts } from "./create-message-queue-with-drafts";
import { setComposerQueueRuntime } from "./composer-queue-runtime";
import { setSilentChatContinue } from "./silent-chat-continue";
import { getChatSettings, setChatSettings } from "./chat-settings";
import { setForceReplaceNextChat } from "./chat-force-replace-ref";
import { stripAllPendingSkillTokens } from "./pending-skill-text";
import { setThreadGoalApi } from "./goal-loop-sync";
import { requestChatStop } from "./chat-stop";
import { resumableStorage } from "./resumable-storage";
import { clearActiveChatRun, getActiveChatRun, setActiveChatRun } from "./active-chat-run";
import { useNetworkReconnectStore } from "./network-reconnect-store";
import {
  findFirstAwaitingFrontendToolIndex,
  FRONTEND_SUSPEND_TOOL_NAMES,
  getFrontendSuspendToolName,
  isAwaitingFrontendToolAnswer,
  needsFrontendSuspendContinuation,
  pendingFrontendToolCallId,
  registerFrontendToolStop,
  registerStreamStop,
  trimAssistantAfterAwaitingTool,
} from "./frontend-suspend-tools";
import {
  createFrontendToolContinuationController,
  createToolContinuationAttemptTracker,
  canAutoContinueChat,
  markToolContinuationAttempt,
  requestFrontendToolContinuation,
  resetFrontendToolContinuationController,
  resetToolContinuationAttemptTracker,
  toolContinuationFingerprint,
  tryContinueFrontendToolChat,
  unmarkToolContinuationAttempt,
} from "./frontend-tool-continuation";
import {
  buildInterruptedBackgroundTaskRows,
  collectCoordinatorDispatchTaskIds,
  collectOptimisticBackgroundTasksFromMessages,
  mergePanelBackgroundTasks,
  stripTaskNotificationUserMessages,
  type BackgroundTaskRow,
} from "./background-task-continuation";
import {
  getBackgroundTasksSnapshot,
  resetBackgroundTasksSnapshot,
  setBackgroundTasksSnapshot,
} from "./background-tasks-store";
import {
  fetchBackgroundTaskSnapshot,
  subscribeBackgroundTaskEvents,
  type BackgroundTasksApiSnapshot,
} from "./background-task-events";
import { registerAskUserResultSubmitter } from "./ask-user-submit-bridge";
import {
  abortAllReadOpenPageReads,
  clearReadOpenPageSubmitted,
  executeReadOpenPageForToolCall,
  isReadOpenPageSubmitted,
  markReadOpenPageSubmitted,
  registerReadOpenPageResultSubmitter,
} from "./read-open-page-submit-bridge";
import {
  isThreadMessageInput,
  resolveThreadMessagesToUi,
} from "./resolve-branch-ui-messages";
import { isPersistableThreadId, syncThreadMessagesToServer } from "./sync-thread-messages";
import { normalizeAssistantMessageParts, assistantPartsSemanticallyEqual } from "@veylin/shared";
import {
  CHAT_STREAM_RECOVERY_EVENT,
  isStuckAwaitingToolContinuation,
} from "./chat-stream-recovery";

export type CustomToCreateMessageFunction = <
  UI_MESSAGE extends UIMessage = UIMessage,
>(
  message: AppendMessage,
) => CreateUIMessage<UI_MESSAGE>;

function normalizeLastAssistantMessage<UI_MESSAGE extends UIMessage>(
  messages: readonly UI_MESSAGE[],
): UI_MESSAGE[] | null {
  const last = messages.at(-1);
  if (last?.role !== "assistant" || !last.parts?.length) return null;

  const normalized = normalizeAssistantMessageParts(last.parts, { mode: 'persist' });
  if (normalized === last.parts) return null;
  if (assistantPartsSemanticallyEqual(normalized, last.parts)) return null;

  return [
    ...messages.slice(0, -1),
    { ...last, parts: normalized as UI_MESSAGE["parts"] },
  ];
}

const toUIMessage = <UI_MESSAGE extends UIMessage>(
  createMessage: CreateUIMessage<UI_MESSAGE>,
  fallbackRole: UI_MESSAGE["role"],
): UI_MESSAGE =>
  ({
    ...createMessage,
    id: createMessage.id ?? generateId(),
    role: createMessage.role ?? fallbackRole,
  }) as UI_MESSAGE;

function extractUserText(message: {
  content?: unknown;
  parts?: readonly unknown[];
}): string {
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .filter(
        (part): part is { type: 'text'; text: string } =>
          !!part &&
          typeof part === 'object' &&
          (part as { type?: string }).type === 'text' &&
          typeof (part as { text?: unknown }).text === 'string',
      )
      .map((part) => part.text)
      .join('');
  }
  if (Array.isArray(message.parts)) {
    return message.parts
      .filter(
        (part): part is { type: 'text'; text: string } =>
          !!part &&
          typeof part === 'object' &&
          (part as { type?: string }).type === 'text' &&
          typeof (part as { text?: unknown }).text === 'string',
      )
      .map((part) => part.text)
      .join('');
  }
  return '';
}

function stripPendingSkillToken<UI_MESSAGE extends UIMessage>(
  message: CreateUIMessage<UI_MESSAGE>,
): CreateUIMessage<UI_MESSAGE> {
  const { pendingSkill, pendingSkillInsertAt } = getChatSettings();
  if (!pendingSkill) return message;

  const next = { ...message } as CreateUIMessage<UI_MESSAGE> & {
    content?: string;
    parts?: Array<Record<string, unknown>>;
  };

  if (typeof next.content === 'string') {
    next.content = stripAllPendingSkillTokens(
      next.content,
      pendingSkill,
      pendingSkillInsertAt,
    );
  }

  if (Array.isArray(next.parts)) {
    next.parts = next.parts.map((part) =>
      part.type === 'text' && typeof part.text === 'string'
        ? {
            ...part,
            text: stripAllPendingSkillTokens(
              part.text,
              pendingSkill,
              pendingSkillInsertAt,
            ),
          }
        : part,
    );
  }

  return next;
}

export type AISDKRuntimeAdapter = ExternalStoreSharedOptions & {
  adapters?:
    | (NonNullable<ExternalStoreAdapter["adapters"]> & {
        history?: ThreadHistoryAdapter | undefined;
      })
    | undefined;
  toCreateMessage?: CustomToCreateMessageFunction;
  /**
   * Whether to automatically cancel pending interactive tool calls when the user sends a new message.
   *
   * When enabled (default), the pending tool calls will be marked as failed with an error message
   * indicating the user cancelled the tool call by sending a new message.
   *
   * @default true
   */
  cancelPendingToolCallsOnSend?: boolean | undefined;
  /**
   * Called when `runtime.thread.resumeRun(config)` is invoked.
   *
   * When omitted, `resumeRun` throws `"Runtime does not support resuming runs."`.
   * Provide this to bridge resume invocations into a custom replay channel
   * (for example, an SSE reconnect endpoint keyed by turn id).
   */
  onResume?: ExternalStoreAdapter["onResume"];
  /**
   * How consecutive assistant messages are rendered.
   *
   * `"concat-content"` (the default) merges them into a single thread message.
   * `"none"` keeps each assistant message as its own thread message, which is
   * useful when a backend persists proactive or consecutive assistant messages
   * as separate entries.
   */
  joinStrategy?: JoinStrategy | undefined;
  /** Server thread id for stop/sync before rewind. */
  getThreadId?: (() => string | undefined) | undefined;
  /** Ensures the remote thread exists on the server before the first chat POST. */
  ensureThreadInitialized?: (() => Promise<string | undefined>) | undefined;
};

export const useAISDKRuntimeWithQueue = <UI_MESSAGE extends UIMessage = UIMessage>(
  chatHelpers: ReturnType<typeof useChat<UI_MESSAGE>>,
  adapter: AISDKRuntimeAdapter = {},
) => {
  const {
    adapters,
    toCreateMessage: customToCreateMessage,
    cancelPendingToolCallsOnSend = true,
    onResume,
    joinStrategy,
    getThreadId,
    ensureThreadInitialized,
  } = adapter;
  const contextAdapters = useRuntimeAdapters();
  const [toolStatuses, setToolStatuses] = useState<
    Record<string, ToolExecutionStatus>
  >({});
  const toolArgsKeyOrderCacheRef = useRef<Map<string, Map<string, string[]>>>(
    new Map(),
  );
  const toolLastInputCacheRef = useRef<Map<string, ReadonlyJSONObject>>(
    new Map(),
  );
  const mcpAppMetadataCacheRef = useRef<Map<string, McpAppMetadata>>(new Map());
  const lastRunConfigRef = useRef<RunConfig | undefined>(undefined);
  const messageCacheRef = useRef(new Map<string, UI_MESSAGE>());
  const [backgroundTasks, setBackgroundTasks] = useState<BackgroundTaskRow[]>([]);
  const backgroundTasksRef = useRef(backgroundTasks);
  const backgroundDispatchTaskIdsRef = useRef<string[]>([]);
  const historyLoadingRef = useRef(false);
  /**
   * Assistant message id that was just restored from persisted history (page load /
   * refresh / thread switch). The effect-driven continuation must never auto-resume a
   * persisted turn — only live tool completions (via applyToolResult) may continue.
   */
  const restoredHistoryHeadRef = useRef<string | null>(null);
  const frontendContinuationRef = useRef(createFrontendToolContinuationController());
  const refreshBackgroundTasksRef = useRef<(() => void) | null>(null);
  /** Task ids cancelled by Stop — keep them cancelled until the API reports a terminal status. */
  const interruptedTaskIdsRef = useRef<Set<string>>(new Set());
  backgroundTasksRef.current = backgroundTasks;

  const resolvedThreadId = getThreadId?.() ?? chatHelpers.id;
  const coordinatorDispatchFingerprint = useMemo(
    () => collectCoordinatorDispatchTaskIds(chatHelpers.messages).join("\0"),
    [chatHelpers.messages],
  );

  const rememberUiMessages = (uiMessages: readonly UI_MESSAGE[]) => {
    for (const message of uiMessages) {
      messageCacheRef.current.set(message.id, message);
    }
  };

  const applyThreadMessagesToChat = (
    input: readonly UI_MESSAGE[] | readonly ThreadMessage[],
  ) => {
    if (!isThreadMessageInput(input)) return;

    const uiMessages = resolveThreadMessagesToUi(
      input,
      messageCacheRef.current,
    );
    rememberUiMessages(uiMessages);
    chatHelpers.setMessages(uiMessages);
  };

  const hasExecutingTools = Object.values(toolStatuses).some(
    (s) => s?.type === "executing",
  );
  const awaitingFrontendToolAnswer = isAwaitingFrontendToolAnswer(
    chatHelpers.messages,
  );
  const needsSuspendContinuation = needsFrontendSuspendContinuation(
    chatHelpers.messages,
  );
  const continuation = frontendContinuationRef.current;
  const continuationInFlight =
    continuation.pending || continuation.continuing;
  // Subagents now run synchronously inside the `task` tool call, so the parent
  // chat stream stays open (status streaming/submitted) for the whole subagent
  // run. Also treat ask/read_open_page continuation gaps as running so Worked-for
  // does not fold between answer submit and the follow-up stream.
  const isRunning =
    chatHelpers.status === "submitted" ||
    chatHelpers.status === "streaming" ||
    hasExecutingTools ||
    awaitingFrontendToolAnswer ||
    needsSuspendContinuation ||
    continuationInFlight;

  // Keep a non-React copy so Cmd+R / unload can stop without reading URL.
  useEffect(() => {
    const threadId = getThreadId?.() ?? chatHelpers.id;
    const streamId = resumableStorage.getStreamId();
    if (isRunning && isPersistableThreadId(threadId) && streamId) {
      setActiveChatRun(threadId, streamId);
      return;
    }
    if (!isRunning) clearActiveChatRun();
  }, [isRunning, chatHelpers.id, getThreadId, chatHelpers.status]);

  const rawMessageTiming = useStreamingTiming(chatHelpers.messages, isRunning);
  const prunedTimingIdsRef = useRef<Set<string>>(new Set());
  const [timingPruneEpoch, setTimingPruneEpoch] = useState(0);
  const messageTiming = useMemo(() => {
    const pruned = prunedTimingIdsRef.current;
    if (pruned.size === 0) return rawMessageTiming;
    const next: typeof rawMessageTiming = {};
    for (const [id, timing] of Object.entries(rawMessageTiming)) {
      if (!pruned.has(id)) next[id] = timing;
    }
    return next;
  }, [rawMessageTiming, timingPruneEpoch]);

  // Flag the streaming message optimistic: its id can be swapped for a server
  // id mid-run, and the repository then drops the orphaned pre-swap id (#4037).
  const lastMessage = chatHelpers.messages.at(-1);
  const optimisticMessageId =
    isRunning && lastMessage?.role === "assistant" ? lastMessage.id : undefined;

  const messages = AISDKMessageConverter.useThreadMessages({
    isRunning,
    messages: chatHelpers.messages,
    joinStrategy,
    metadata: useMemo(
      () => ({
        toolStatuses,
        messageTiming,
        toolArgsKeyOrderCache: toolArgsKeyOrderCacheRef.current,
        toolLastInputCache: toolLastInputCacheRef.current,
        mcpAppMetadataCache: mcpAppMetadataCacheRef.current,
        ...(optimisticMessageId && { optimisticMessageId }),
        ...(isRunning && chatHelpers.error && { error: chatHelpers.error.message }),
      }),
      [toolStatuses, messageTiming, optimisticMessageId, chatHelpers.error],
    ),
  });

  const [runtimeRef] = useState(() => ({
    get current(): AssistantRuntime {
      return runtime;
    },
  }));

  const { isLoading, deleteMessage: deleteHistoryMessage } = useExternalHistory(
    runtimeRef,
    adapters?.history ?? contextAdapters?.history,
    AISDKMessageConverter.toThreadMessages as (
      messages: UI_MESSAGE[],
    ) => ThreadMessage[],
    aiSDKV6FormatAdapter as MessageFormatAdapter<
      UI_MESSAGE,
      AISDKStorageFormat
    >,
    (messages) => {
      rememberUiMessages(messages);
      const last = messages.at(-1);
      restoredHistoryHeadRef.current =
        last?.role === "assistant" ? last.id : null;
      chatHelpers.setMessages(messages);
    },
    {
      getChatMessageCount: () => chatHelpers.messages.length,
    },
  );

  historyLoadingRef.current = isLoading;

  useEffect(() => {
    if (isLoading) return;
    if (!isPersistableThreadId(resolvedThreadId)) return;
    refreshBackgroundTasksRef.current?.();
  }, [isLoading, resolvedThreadId]);

  const chatHelpersRef = useRef(chatHelpers);
  chatHelpersRef.current = chatHelpers;

  const completePendingToolCalls = async (reason = 'User cancelled tool call by sending a new message.') => {
    if (!cancelPendingToolCallsOnSend && reason.includes('sending a new message')) return;

    chatHelpers.setMessages((messages) => {
      const lastMessage = messages.at(-1);
      if (lastMessage?.role !== "assistant") return messages;

      let hasChanges = false;
      const parts = lastMessage.parts?.map((part) => {
        if (!isToolUIPart(part)) return part;
        if (part.state === "output-available" || part.state === "output-error")
          return part;

        hasChanges = true;
        const { approval: _approval, ...rest } = part;
        return {
          ...rest,
          state: "output-error" as const,
          errorText: reason,
        };
      });

      if (!hasChanges) return messages;
      return [...messages.slice(0, -1), { ...lastMessage, parts }];
    });
  };

  const dispatchNewRef = useRef<(message: AppendMessage) => Promise<void>>(
    async () => {},
  );

  const [queueCtrl] = useState(() => {
    let ctrl!: ReturnType<typeof createMessageQueueWithDrafts>;
    ctrl = createMessageQueueWithDrafts({
      run: (message, { steer }) => {
        ctrl.notifyBusy();
        void (async () => {
          try {
            if (steer) {
              // Same interrupt path as Stop: mark interrupted, suppress auto-continue.
              interruptChatRun();
            }
            await dispatchNewRef.current(message);
          } finally {
            ctrl.notifyIdle();
          }
        })();
      },
      cancel: () => {
        interruptChatRun();
      },
    });
    return ctrl;
  });

  const [, queueVersion] = useState(0);
  useEffect(() => queueCtrl.subscribe(() => queueVersion((n) => n + 1)), [queueCtrl]);

  useEffect(() => {
    setComposerQueueRuntime({
      getQueuedMessage: (id) => queueCtrl.getQueuedMessage(id),
      popQueuedMessage: (id) => queueCtrl.popQueuedMessage(id),
    });
    return () => setComposerQueueRuntime(null);
  }, [queueCtrl]);

  useEffect(() => {
    setSilentChatContinue(async () => {
      resumableStorage.clear();
      await chatHelpersRef.current.sendMessage(undefined, {
        metadata: lastRunConfigRef.current,
      });
    });
    return () => setSilentChatContinue(null);
  }, []);

  useEffect(() => {
    rememberUiMessages(chatHelpers.messages);
  }, [chatHelpers.messages]);

  useEffect(() => {
    const flushTranscript = () => {
      const threadId = getThreadId?.() ?? chatHelpersRef.current.id;
      if (!isPersistableThreadId(threadId)) return;
      const messages = chatHelpersRef.current.messages;
      if (messages.length === 0) return;
      void syncThreadMessagesToServer(threadId, messages, { forceReplace: true });
    };

    const stopIfRunning = () => {
      const threadId = getThreadId?.() ?? chatHelpersRef.current.id;
      if (!isPersistableThreadId(threadId)) return;
      const status = chatHelpersRef.current.status;
      const streaming = status === 'submitted' || status === 'streaming';
      const hasStream = Boolean(
        resumableStorage.getStreamId() ?? getActiveChatRun()?.streamId,
      );
      if (!streaming && !hasStream) return;
      void requestChatStop(threadId, { keepalive: true });
    };

    const onPageHide = (event: PageTransitionEvent) => {
      // bfcache: keep the run so resume can reconnect.
      if (event.persisted) {
        flushTranscript();
        return;
      }
      flushTranscript();
      stopIfRunning();
    };

    const onBeforeUnload = () => {
      flushTranscript();
      stopIfRunning();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushTranscript();
    };

    // pagehide is the reliable unload signal; beforeunload is a backup for
    // environments (e.g. some WebViews) that fire it more consistently.
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [getThreadId]);

  const stoppedFrontendToolIdsRef = useRef<Set<string>>(new Set());
  const stampedAssistantIdsRef = useRef<Set<string>>(new Set());
  const continuationLastErrorRef = useRef<unknown>(null);
  const toolContinuationAttemptRef = useRef(createToolContinuationAttemptTracker());
  const prevChatStatusRef = useRef(chatHelpers.status);
  /** When set, auto-continue is blocked for this assistant message id (user cancelled). */
  const suppressedForAssistantIdRef = useRef<string | null>(null);

  const suppressToolContinuation = () => {
    const last = chatHelpersRef.current.messages.at(-1);
    suppressedForAssistantIdRef.current =
      last?.role === "assistant" ? last.id : null;
    resetFrontendToolContinuationController(frontendContinuationRef.current);
    resetToolContinuationAttemptTracker(toolContinuationAttemptRef.current);
  };

  const clearToolContinuationSuppression = () => {
    suppressedForAssistantIdRef.current = null;
    resetToolContinuationAttemptTracker(toolContinuationAttemptRef.current);
    resetFrontendToolContinuationController(frontendContinuationRef.current);
  };

  const isToolContinuationSuppressed = (messages: UI_MESSAGE[]) => {
    const id = suppressedForAssistantIdRef.current;
    if (!id) return false;
    const last = messages.at(-1);
    return last?.role === "assistant" && last.id === id;
  };

  const finalizeInterruptedAssistant = () => {
    chatHelpersRef.current.setMessages((current) => {
      const last = current.at(-1);
      if (last?.role !== "assistant") return current;
      const custom = (
        last.metadata as { custom?: { sentAt?: number; interrupted?: boolean } } | undefined
      )?.custom;
      if (custom?.interrupted === true && typeof custom.sentAt === "number") {
        return current;
      }
      stampedAssistantIdsRef.current.add(last.id);
      return [...current.slice(0, -1), stampInterruptedAssistant(last)];
    });
  };

  const interruptChatRun = () => {
    suppressToolContinuation();
    abortAllReadOpenPageReads();
    // Prevent the pending-tool effect from starting a new read after Stop.
    const last = chatHelpersRef.current.messages.at(-1);
    if (last?.role === 'assistant' && last.parts?.length) {
      for (let i = 0; i < last.parts.length; i++) {
        const part = last.parts[i] as { toolCallId?: string; type?: string };
        if (getFrontendSuspendToolName(part) !== 'read_open_page') continue;
        const id = pendingFrontendToolCallId(last, i, part);
        markReadOpenPageSubmitted(id);
      }
    }
    useNetworkReconnectStore.getState().clearBanner();
    const streamId = resumableStorage.getStreamId();
    chatHelpersRef.current.stop();
    setToolStatuses({});
    // Mark in-flight tool parts cancelled so TaskToolUI / tool groups leave "running"
    // (Claude Code synthesizes interrupted tool_result on user-cancel).
    void completePendingToolCalls('Interrupted by user.');
    finalizeInterruptedAssistant();

    const threadId = getThreadId?.() ?? chatHelpersRef.current.id;

    // Optimistically cancel local + transcript-dispatched subagent rows so the
    // status bar does not fall back to optimistic "running" placeholders.
    // Collect from UI parts AND coordinator dispatch ids (real task_id), including
    // temporary task-call-* ids so empty-filter races cannot wipe the panel.
    const prevSnapshot = getBackgroundTasksSnapshot();
    const messages = chatHelpersRef.current.messages;
    const optimistic = collectOptimisticBackgroundTasksFromMessages(messages);
    const dispatchIds = collectCoordinatorDispatchTaskIds(messages);
    const cancelledTasks = buildInterruptedBackgroundTaskRows(
      [...prevSnapshot.tasks, ...prevSnapshot.batchTasks],
      optimistic,
      [...(prevSnapshot.dispatchTaskIds ?? []), ...dispatchIds],
    );
    const nextDispatchIds = Array.from(
      new Set([
        ...(prevSnapshot.dispatchTaskIds ?? []),
        ...dispatchIds,
        ...optimistic.map((row) => row.id),
        ...cancelledTasks.map((row) => row.id),
      ]),
    );
    // Only the rows we actually cancelled — not the entire dispatch history.
    const interruptedTaskIds = Array.from(
      new Set([
        ...(prevSnapshot.interruptedTaskIds ?? []),
        ...cancelledTasks.map((row) => row.id),
      ]),
    );
    for (const id of interruptedTaskIds) interruptedTaskIdsRef.current.add(id);
    setBackgroundTasks(cancelledTasks);
    backgroundTasksRef.current = cancelledTasks;
    setBackgroundTasksSnapshot({
      ...prevSnapshot,
      threadId: prevSnapshot.threadId ?? threadId ?? null,
      tasks: cancelledTasks,
      batchTasks: cancelledTasks,
      dispatchTaskIds: nextDispatchIds,
      interruptedTaskIds,
    });

    if (threadId) {
      void requestChatStop(threadId, { activeStreamId: streamId })
        .catch((err) => {
          console.warn("[chat] interrupt stop failed", err);
        })
        .finally(() => {
          refreshBackgroundTasksRef.current?.();
        });
    } else {
      resumableStorage.clear();
    }
  };

  const stopFrontendToolStream = (reason: string, toolCallIds?: string | string[]) => {
    useNetworkReconnectStore.getState().clearReconnecting();
    chatHelpersRef.current.stop();
    const threadId = getThreadId?.() ?? chatHelpersRef.current.id;
    if (!threadId) return;
    const stopPromise = requestChatStop(threadId).catch((err) => {
      console.warn(`[chat] frontend tool ${reason} stop failed`, err);
    });
    const ids = (
      toolCallIds == null ? [] : Array.isArray(toolCallIds) ? toolCallIds : [toolCallIds]
    ).filter(Boolean);
    for (const id of ids) {
      registerFrontendToolStop(id, stopPromise);
    }
  };

  const ensureFrontendToolStreamStopped = async (): Promise<void> => {
    chatHelpersRef.current.stop();
    const threadId = getThreadId?.() ?? chatHelpersRef.current.id;
    if (!threadId) return;
    const streamId = resumableStorage.getStreamId();
    const stopPromise = requestChatStop(threadId, { activeStreamId: streamId }).catch((err) => {
      console.warn("[chat] frontend tool ensure stop failed", err);
    });
    registerStreamStop(stopPromise);
    await stopPromise;
  };

  const continueFrontendToolIfReady = () => {
    void tryContinueFrontendToolChat({
      controller: frontendContinuationRef.current,
      getStatus: () => chatHelpersRef.current.status,
      getMessages: () => chatHelpersRef.current.messages,
      stopStream: () => stopFrontendToolStream("continue", undefined),
      ensureStopped: ensureFrontendToolStreamStopped,
      sendMessage: async () => {
        resumableStorage.clear();
        await chatHelpersRef.current.sendMessage(undefined, {
          metadata: lastRunConfigRef.current,
        });
      },
      clearError: () => chatHelpersRef.current.clearError(),
      lastError: continuationLastErrorRef,
      onSendFailed: () => {
        resetToolContinuationAttemptTracker(toolContinuationAttemptRef.current);
      },
    });
  };

  const scheduleToolContinuationIfNeeded = () => {
    const messages = chatHelpersRef.current.messages;
    const status = chatHelpersRef.current.status;
    if (isToolContinuationSuppressed(messages)) return;

    if (status !== "ready") return;
    if (!canAutoContinueChat(messages, status)) {
      return;
    }

    const fingerprint = toolContinuationFingerprint(messages);
    if (!fingerprint) return;
    if (
      !markToolContinuationAttempt(
        toolContinuationAttemptRef.current,
        fingerprint,
      )
    ) {
      return;
    }

    if (
      !requestFrontendToolContinuation(
        frontendContinuationRef.current,
        continueFrontendToolIfReady,
      )
    ) {
      unmarkToolContinuationAttempt(
        toolContinuationAttemptRef.current,
        fingerprint,
      );
    }
  };

  const recoverStuckChatRun = useCallback(async () => {
    const chat = chatHelpersRef.current;
    const messages = chat.messages;
    const status = chat.status;
    // Only the frontend-suspend tool continuation can wedge now (a client-completed
    // suspend tool whose follow-up POST never fired). Subagents keep the stream open
    // legitimately, so a streaming coordinator turn is not "stuck".
    const stuckTool = isStuckAwaitingToolContinuation(messages, status);
    if (!stuckTool) {
      return;
    }

    const threadId = getThreadId?.() ?? chat.id;
    if (threadId) {
      try {
        const activityRes = await fetch("/api/threads/activity", {
          credentials: "include",
        });
        if (activityRes.ok) {
          const data = (await activityRes.json()) as {
            activity?: Record<string, { kind?: string }>;
          };
          if (data.activity?.[threadId]?.kind === "running") return;
        }
      } catch {
        /* proceed — activity probe is best-effort */
      }
    }

    resumableStorage.clear();
    useNetworkReconnectStore.getState().clearTransientBanner();
    resetFrontendToolContinuationController(frontendContinuationRef.current);
    chat.stop();
  }, [getThreadId]);

  const applyToolResult = useCallback(
    async ({
      toolCallId,
      toolName,
      result,
      isError,
      modelContent,
    }: {
      toolCallId: string;
      toolName: string;
      result: unknown;
      isError?: boolean;
      modelContent?: Parameters<typeof wrapModelContentEnvelope>[1];
    }) => {
      // A live tool result means the user is actively driving this turn; lift the
      // history-restore guard so legitimate continuation can proceed.
      restoredHistoryHeadRef.current = null;
      if (isToolContinuationSuppressed(chatHelpersRef.current.messages)) {
        return;
      }

      useNetworkReconnectStore.getState().clearReconnecting();
      const options = { metadata: lastRunConfigRef.current };
      const isFrontendSuspend = (
        FRONTEND_SUSPEND_TOOL_NAMES as readonly string[]
      ).includes(toolName);

      const chat = chatHelpersRef.current;
      if (isError) {
        await chat.addToolOutput({
          state: "output-error",
          tool: toolName ?? toolCallId,
          toolCallId,
          errorText:
            typeof result === "string" ? result : JSON.stringify(result),
          options,
        });
      } else {
        const output =
          modelContent !== undefined
            ? wrapModelContentEnvelope(result, modelContent)
            : result;
        await chat.addToolResult({
          tool: toolName,
          toolCallId,
          output,
          options,
        });
      }

      if (!isFrontendSuspend) return;

      if (isToolContinuationSuppressed(chatHelpersRef.current.messages)) {
        return;
      }

      const status = chatHelpersRef.current.status;
      if (status === "streaming" || status === "submitted") {
        requestFrontendToolContinuation(
          frontendContinuationRef.current,
          continueFrontendToolIfReady,
        );
      } else if (status === "ready") {
        scheduleToolContinuationIfNeeded();
      }
    },
    [],
  );

  useEffect(() => {
    const threadId = chatHelpers.id;
    registerAskUserResultSubmitter(threadId, (toolCallId, result) => {
      return applyToolResult({
        toolCallId,
        toolName: "ask_user_question",
        result,
      });
    });
    registerReadOpenPageResultSubmitter(threadId, (toolCallId, result, options) => {
      return applyToolResult({
        toolCallId,
        toolName: "read_open_page",
        result: options?.isError ? (result.error ?? result) : result,
        isError: options?.isError,
      });
    });
    return () => {
      registerAskUserResultSubmitter(threadId, null);
      registerReadOpenPageResultSubmitter(threadId, null);
    };
  }, [applyToolResult, chatHelpers.id]);

  useEffect(() => {
    const listItemId = chatHelpers.id;

    const resolvePersistableThreadId = (): string | null => {
      const threadId = getThreadId?.() ?? listItemId;
      return isPersistableThreadId(threadId) ? threadId : null;
    };

    let cancelled = false;
    let retryTimer: number | null = null;
    let threadIdWaitTimer: number | null = null;
    let unsubscribe: (() => void) | null = null;

    const applyBackgroundTaskSnapshot = (
      data: BackgroundTasksApiSnapshot | null,
      localMessages: UI_MESSAGE[],
      snapshotThreadId: string | null,
    ) => {
      if (!data) return;
      // Ignore late responses for a thread we already navigated away from.
      if (snapshotThreadId && snapshotThreadId !== resolvePersistableThreadId()) return;
      let tasks = data.tasks ?? [];
      if (interruptedTaskIdsRef.current.size > 0) {
        tasks = tasks.map((task) => {
          if (!interruptedTaskIdsRef.current.has(task.id)) return task;
          if (task.status === 'done' || task.status === 'failed' || task.status === 'cancelled') {
            interruptedTaskIdsRef.current.delete(task.id);
            return task;
          }
          return { ...task, status: 'cancelled' };
        });
      }
      const ready = Boolean(data.batch?.notificationsReady);

      const dispatchIds = collectCoordinatorDispatchTaskIds(localMessages);
      const lastMsg = localMessages.at(-1);
      const prevSnapshot = getBackgroundTasksSnapshot();
      const prevPinnableForThread =
        prevSnapshot.threadId === snapshotThreadId ? prevSnapshot.dispatchTaskIds : [];
      const previousPinnedIds = lastMsg?.role === "user" ? [] : prevPinnableForThread;
      const knownBatchIds = Array.from(new Set([...previousPinnedIds, ...dispatchIds]));

      const activeTaskIds = tasks
        .filter((t) => t.status === "queued" || t.status === "running")
        .map((t) => t.id);
      const nextDispatchIds = Array.from(
        new Set([
          ...knownBatchIds,
          ...activeTaskIds,
        ]),
      );
      backgroundDispatchTaskIdsRef.current = nextDispatchIds;

      const panelTasks = mergePanelBackgroundTasks(localMessages, tasks, {
        pinnedTaskIds: nextDispatchIds,
      });
      const interruptedTaskIds = Array.from(interruptedTaskIdsRef.current);
      setBackgroundTasks(tasks);
      backgroundTasksRef.current = tasks;
      setBackgroundTasksSnapshot({
        threadId: snapshotThreadId,
        tasks,
        batchTasks: panelTasks,
        dispatchTaskIds: nextDispatchIds,
        interruptedTaskIds,
        notificationsReady: ready,
        synthesisReady: false,
      });

      // Display-only: drives the subagent panel / TaskToolUI progress.
    };

    const refreshBackgroundTasks = async () => {
      if (cancelled) return;
      const threadId = resolvePersistableThreadId();
      if (!threadId) return;
      const chat = chatHelpersRef.current;
      const localMessages = chat.messages;
      const dispatchIds = collectCoordinatorDispatchTaskIds(localMessages);
      const lastMsg = localMessages.at(-1);
      const prevSnapshot = getBackgroundTasksSnapshot();
      const prevPinnableForThread =
        prevSnapshot.threadId === threadId ? prevSnapshot.dispatchTaskIds : [];
      const previousPinnedIds = lastMsg?.role === "user" ? [] : prevPinnableForThread;
      const knownBatchIds = Array.from(new Set([...previousPinnedIds, ...dispatchIds]));
      const data = await fetchBackgroundTaskSnapshot(threadId, knownBatchIds).catch(() => null);
      if (cancelled) return;
      applyBackgroundTaskSnapshot(data, localMessages, threadId);
    };

    const scheduleRetrySnapshot = () => {
      if (retryTimer != null) return;
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        void refreshBackgroundTasks();
      }, 5000);
    };

    const startBackgroundTaskSubscription = () => {
      const threadId = resolvePersistableThreadId();
      if (!threadId || cancelled) return;

      refreshBackgroundTasksRef.current = () => {
        void refreshBackgroundTasks();
      };

      unsubscribe = subscribeBackgroundTaskEvents(
        threadId,
        () => {
          // SSE snapshots omit batchIds, so readiness must come from a scoped /api/tasks fetch.
          void refreshBackgroundTasks();
        },
        scheduleRetrySnapshot,
      );

      void refreshBackgroundTasks();
    };

    if (resolvePersistableThreadId()) {
      startBackgroundTaskSubscription();
    } else {
      threadIdWaitTimer = window.setInterval(() => {
        if (cancelled) return;
        if (!resolvePersistableThreadId()) return;
        if (threadIdWaitTimer != null) {
          window.clearInterval(threadIdWaitTimer);
          threadIdWaitTimer = null;
        }
        startBackgroundTaskSubscription();
      }, 300);
    }

    return () => {
      cancelled = true;
      refreshBackgroundTasksRef.current = null;
      unsubscribe?.();
      if (retryTimer != null) window.clearTimeout(retryTimer);
      if (threadIdWaitTimer != null) window.clearInterval(threadIdWaitTimer);
      setBackgroundTasks([]);
      backgroundTasksRef.current = [];
      backgroundDispatchTaskIdsRef.current = [];
      interruptedTaskIdsRef.current.clear();
      resetBackgroundTasksSnapshot();
    };
  }, [chatHelpers.id, getThreadId]);

  useEffect(() => {
    stampedAssistantIdsRef.current = new Set();
    stoppedFrontendToolIdsRef.current = new Set();
    restoredHistoryHeadRef.current = null;
    clearReadOpenPageSubmitted();
    abortAllReadOpenPageReads();
    setToolStatuses({});
    resetFrontendToolContinuationController(frontendContinuationRef.current);
    resetToolContinuationAttemptTracker(toolContinuationAttemptRef.current);
    resumableStorage.clear();
    useNetworkReconnectStore.getState().clearReconnecting();
    const chat = chatHelpersRef.current;
    if (chat.status === "streaming" || chat.status === "submitted") {
      chat.stop();
    }
  }, [chatHelpers.id]);

  useEffect(() => {
    if (!isPersistableThreadId(resolvedThreadId)) return;
    refreshBackgroundTasksRef.current?.();
  }, [resolvedThreadId, coordinatorDispatchFingerprint]);

  useEffect(() => {
    const prev = prevChatStatusRef.current;
    prevChatStatusRef.current = chatHelpers.status;

    if (chatHelpers.status === "ready" && prev !== "ready") {
      frontendContinuationRef.current.sendStarted = false;
      const last = chatHelpers.messages.at(-1);
      if (last?.role === "assistant") {
        const stripped = stripTaskNotificationUserMessages(chatHelpers.messages);
        if (stripped.length !== chatHelpers.messages.length) {
          rememberUiMessages(stripped as unknown as readonly UI_MESSAGE[]);
          chatHelpers.setMessages(stripped as unknown as UI_MESSAGE[]);
        }
      }
    }

    const normalized = normalizeLastAssistantMessage(chatHelpers.messages);
    if (normalized) {
      rememberUiMessages(normalized);
      chatHelpers.setMessages(normalized);
      return;
    }

    // A turn restored from persisted history must not auto-resume on load/refresh.
    // Live tool completions still continue via applyToolResult, which clears this.
    const last = chatHelpers.messages.at(-1);
    if (last && restoredHistoryHeadRef.current === last.id) {
      return;
    }

    scheduleToolContinuationIfNeeded();
  }, [chatHelpers.status, chatHelpers.messages]);

  useEffect(() => {
    const onRecovery = () => {
      void recoverStuckChatRun();
    };
    window.addEventListener(CHAT_STREAM_RECOVERY_EVENT, onRecovery);
    return () => window.removeEventListener(CHAT_STREAM_RECOVERY_EVENT, onRecovery);
  }, [recoverStuckChatRun]);

  useEffect(() => {
    const stuckTool = isStuckAwaitingToolContinuation(
      chatHelpers.messages,
      chatHelpers.status,
    );
    if (!stuckTool) {
      return;
    }
    const timer = window.setTimeout(() => {
      void recoverStuckChatRun();
    }, 750);
    return () => window.clearTimeout(timer);
  }, [chatHelpers.messages, chatHelpers.status, recoverStuckChatRun]);

  useEffect(() => {
    const last = chatHelpers.messages.at(-1);
    if (last?.role !== "assistant" || !last.parts?.length) return;

    const pendingIndex = findFirstAwaitingFrontendToolIndex(last.parts);
    if (pendingIndex < 0) return;

    const pendingPart = last.parts[pendingIndex] as {
      toolCallId?: string;
      type?: string;
      input?: { mode?: 'text' | 'html'; maxChars?: number };
      args?: { mode?: 'text' | 'html'; maxChars?: number };
    };
    const toolCallId = pendingFrontendToolCallId(last, pendingIndex, pendingPart);
    const toolName = getFrontendSuspendToolName(pendingPart);

    if (!stoppedFrontendToolIdsRef.current.has(toolCallId)) {
      stoppedFrontendToolIdsRef.current.add(toolCallId);
      const stopIds = [toolCallId];
      if (pendingPart.toolCallId && pendingPart.toolCallId !== toolCallId) {
        stopIds.push(pendingPart.toolCallId);
      }
      stopFrontendToolStream("open", stopIds);
    }

    // Drive read_open_page via bridge — does not depend on ToolUI addResult after chat.stop().
    if (toolName === 'read_open_page' && !isReadOpenPageSubmitted(toolCallId)) {
      const threadId = getThreadId?.() ?? chatHelpers.id;
      const input = (pendingPart.input ?? pendingPart.args ?? {}) as {
        mode?: 'text' | 'html';
        maxChars?: number;
        tabId?: string;
      };
      const attachedTabId = getChatSettings().attachedBrowserTab?.tabId;
      void executeReadOpenPageForToolCall({
        threadId,
        toolCallId,
        mode: input.mode,
        maxChars: input.maxChars,
        tabId: typeof input.tabId === 'string' ? input.tabId : undefined,
        attachedTabId: attachedTabId ?? undefined,
      });
    }

    const trimmed = trimAssistantAfterAwaitingTool(chatHelpers.messages);
    if (trimmed) {
      chatHelpers.setMessages(trimmed as UI_MESSAGE[]);
    }
  }, [chatHelpers.messages, chatHelpers, getThreadId]);

  useEffect(() => {
    if (!isRunning) return;
    const last = chatHelpers.messages.at(-1);
    if (last?.role !== "assistant") return;
    if (stampedAssistantIdsRef.current.has(last.id)) return;
    const custom = (last.metadata as { custom?: { sentAt?: number } } | undefined)
      ?.custom;
    if (typeof custom?.sentAt === "number") {
      stampedAssistantIdsRef.current.add(last.id);
      return;
    }
    stampedAssistantIdsRef.current.add(last.id);
    chatHelpers.setMessages((current) =>
      current.map((m) =>
        m.id === last.id ? stampMessageWithSentAt(m) : m,
      ),
    );
  }, [isRunning, chatHelpers.messages, chatHelpers]);

  useEffect(() => {
    if (isRunning) return;
    const last = chatHelpers.messages.at(-1);
    if (last?.role !== "assistant") return;
    if (stampedAssistantIdsRef.current.has(last.id)) return;
    const custom = (last.metadata as { custom?: { sentAt?: number } } | undefined)
      ?.custom;
    if (typeof custom?.sentAt === "number") {
      stampedAssistantIdsRef.current.add(last.id);
      return;
    }
    stampedAssistantIdsRef.current.add(last.id);
    chatHelpers.setMessages((current) =>
      current.map((m) =>
        m.id === last.id ? stampMessageWithSentAt(m) : m,
      ),
    );
  }, [isRunning, chatHelpers.messages, chatHelpers]);

  const handleNew = async (message: AppendMessage) => {
    const createMessage = stripPendingSkillToken((
      customToCreateMessage ?? toCreateMessage
    )<UI_MESSAGE>(message));

    if (!(message.startRun ?? message.role === "user")) {
      chatHelpers.setMessages((current) => [
        ...current,
        toUIMessage<UI_MESSAGE>(
          stampOutgoingUserMessage(createMessage),
          message.role,
        ),
      ]);
      return;
    }

    const last = chatHelpersRef.current.messages.at(-1);
    const lastCustom = (
      last?.metadata as { custom?: { interrupted?: boolean } } | undefined
    )?.custom;
    const lastInterrupted =
      last?.role === "assistant" && lastCustom?.interrupted === true;
    // Align with onEdit: after interrupt/stop, force-replace so transcript sync
    // does not race a partial auto-continue against the new user turn.
    if (lastInterrupted || suppressedForAssistantIdRef.current != null) {
      setForceReplaceNextChat(true);
    }

    backgroundDispatchTaskIdsRef.current = [];
    interruptedTaskIdsRef.current.clear();
    resetBackgroundTasksSnapshot();
    lastRunConfigRef.current = message.runConfig;
    await completePendingToolCalls();
    let ensuredThreadId: string | undefined;
    if (ensureThreadInitialized) {
      ensuredThreadId = await ensureThreadInitialized();
    }

    // Pending goal from + menu: first user message becomes the completion condition.
    const settings = getChatSettings();
    if (settings.pendingGoal) {
      const threadId =
        ensuredThreadId ?? getThreadId?.() ?? chatHelpersRef.current.id;
      const condition = extractUserText(createMessage).trim();
      if (threadId && condition) {
        const result = await setThreadGoalApi(threadId, condition);
        if (result.ok) {
          setChatSettings({ pendingGoal: false });
        }
      }
    }
    // Pending loop: do not start here. The model analyzes completeness and calls loop_set.

    await chatHelpers.sendMessage(stampOutgoingUserMessage(createMessage), {
      metadata: message.runConfig,
    });
    // Clear suppression only after the new user message is in flight so a
    // pending sendMessage(undefined) auto-continue cannot race.
    clearToolContinuationSuppression();
    setChatSettings({ pendingSkill: null });
  };

  dispatchNewRef.current = handleNew;

  const runtime = useExternalStoreRuntime({
    isRunning,
    messages,
    unstable_enableToolInvocations: true,
    setToolStatuses,
    queue: queueCtrl.adapter,
    setMessages: applyThreadMessagesToChat,
    onImport: applyThreadMessagesToChat,
    onExportExternalState: (): MessageFormatRepository<UI_MESSAGE> => {
      const exported = runtimeRef.current.thread.export();

      const expandedMessages: MessageFormatItem<UI_MESSAGE>[] = [];
      const lastInnerIdMap = new Map<string, string>();

      for (const item of exported.messages) {
        const innerMessages = getExternalStoreMessages<UI_MESSAGE>(
          item.message,
        );
        let parentId =
          item.parentId != null
            ? (lastInnerIdMap.get(item.parentId) ?? item.parentId)
            : null;
        for (const innerMessage of innerMessages) {
          expandedMessages.push({ parentId, message: innerMessage });
          parentId = aiSDKV6FormatAdapter.getId(innerMessage as UIMessage);
        }
        if (innerMessages.length > 0) {
          lastInnerIdMap.set(
            item.message.id,
            aiSDKV6FormatAdapter.getId(
              innerMessages[innerMessages.length - 1]! as UIMessage,
            ),
          );
        }
      }

      const result: MessageFormatRepository<UI_MESSAGE> = {
        messages: expandedMessages,
      };

      if (exported.headId != null) {
        result.headId = lastInnerIdMap.get(exported.headId) ?? exported.headId;
      }

      return result;
    },
    onLoadExternalState: (repo: MessageFormatRepository<UI_MESSAGE>) => {
      // Convert MessageFormatRepository to ExportedMessageRepository
      const exportedRepo = toExportedMessageRepository(
        AISDKMessageConverter.toThreadMessages,
        repo,
      );

      // Import into the thread's MessageRepository
      runtimeRef.current.thread.import(exportedRepo);
    },
    onCancel: async () => {
      const restore = queueCtrl.takeCancelRestorePrompts();
      interruptChatRun();
      if (restore.length > 0) {
        const combined = restore.join("\n\n");
        queueMicrotask(() => {
          runtimeRef.current.thread.composer.setText(combined);
        });
      }
    },
    onNew: handleNew,
    onEdit: async (message) => {
      const createMessage = stripPendingSkillToken((
        customToCreateMessage ?? toCreateMessage
      )<UI_MESSAGE>(message));
      const shouldRun = message.startRun ?? message.role === "user";

      if (!shouldRun) {
        chatHelpers.setMessages((current) => [
          ...sliceMessagesForLinearEdit(current, message.sourceId, message.parentId),
          toUIMessage<UI_MESSAGE>(
            stampOutgoingUserMessage(createMessage),
            message.role,
          ),
        ]);
        return;
      }

      const threadId = getThreadId?.();
      if (threadId) {
        try {
          await requestChatStop(threadId);
        } catch (err) {
          console.warn("[chat] edit stop failed", err);
        }
      }
      if (isRunning) chatHelpers.stop();

      clearToolContinuationSuppression();
      backgroundDispatchTaskIdsRef.current = [];
      interruptedTaskIdsRef.current.clear();
      resetBackgroundTasksSnapshot();
      setForceReplaceNextChat(true);
      lastRunConfigRef.current = message.runConfig;
      await completePendingToolCalls();
      const beforeIds = new Set(chatHelpers.messages.map((m) => m.id));
      const sliced = sliceMessagesForLinearEdit(
        chatHelpers.messages,
        message.sourceId,
        message.parentId,
      );
      for (const id of beforeIds) {
        if (!sliced.some((m) => m.id === id)) {
          prunedTimingIdsRef.current.add(id);
        }
      }
      if (prunedTimingIdsRef.current.size > 0) {
        setTimingPruneEpoch((n) => n + 1);
      }
      chatHelpers.setMessages(sliced);
      await chatHelpers.sendMessage(stampOutgoingUserMessage(createMessage), {
        metadata: message.runConfig,
      });
      setChatSettings({ pendingSkill: null });
    },
    onDelete: async (messageId) => {
      const threadMessages = runtimeRef.current.thread.getState().messages;
      const messageIndex = threadMessages.findIndex(
        (message) => message.id === messageId,
      );
      if (messageIndex === -1) return;

      await deleteHistoryMessage(messageId);

      const deleteIds = new Set(
        getExternalStoreMessages<UI_MESSAGE>(threadMessages[messageIndex]!).map(
          (message) => message.id,
        ),
      );
      chatHelpers.setMessages((current) =>
        current.filter((message) => !deleteIds.has(message.id)),
      );
    },
    onAddToolResult: ({
      toolCallId,
      toolName,
      result,
      isError,
      modelContent,
    }) => {
      void applyToolResult({
        toolCallId,
        toolName: toolName ?? toolCallId,
        result,
        isError,
        modelContent,
      });
    },
    onRespondToToolApproval: ({ approvalId, approved, reason }) => {
      void chatHelpers.addToolApprovalResponse({
        id: approvalId,
        approved,
        ...(reason != null && { reason }),
        options: { metadata: lastRunConfigRef.current },
      });
    },
    ...pickExternalStoreSharedOptions(adapter),
    ...(onResume && { onResume }),
    adapters: {
      attachments: vercelAttachmentAdapter,
      ...contextAdapters,
      ...adapters,
    },
    isLoading,
    extras: queueVersion,
  });

  return runtime;
};
