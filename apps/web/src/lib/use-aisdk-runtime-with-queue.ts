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
} from '@/vendor/assistant-ui';
import type { AISDKStorageFormat } from '@/vendor/assistant-ui';
import { sliceMessagesForLinearEdit } from "./slice-messages-for-linear-edit";
import {
  useExternalHistory,
  toExportedMessageRepository,
} from './use-external-history';
import { stampInterruptedAssistant, stampMessageWithSentAt } from "./message-timestamp";
import { stampOutgoingUserMessage } from "./pending-skill-message";
import { clearPendingQuote } from "./pending-quote";
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
  pendingFrontendToolCallId,
} from "./frontend-suspend-tools";
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
import { registerPendingAskUserSession } from "./pending-ask-user-session";
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
  discardNativeResumeRequest,
  findNativeToolSuspension,
  stageNativeResumeRequest,
} from "./native-suspend-resume";
import {
  assistantTurnWorkMs,
  createAssistantTurnTiming,
  reasoningSegmentKey,
  reduceAssistantTurnTiming,
  type AssistantTurnTiming,
} from "./assistant-turn-timing";
import type { MessageTiming } from "@assistant-ui/core";

/** Idle grace period before a still-"running" turn is treated as wedged. */
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
  const outgoingThreadIds = () =>
    [getThreadId?.(), chatHelpers.id].filter((id): id is string => Boolean(id));
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
  // A native suspension is an idle run waiting on the user, not active work.
  // Tool status can remain "executing" in assistant-ui while suspended, so do
  // not let it pin the message timer/spinner.
  const derivedRunning = hasExecutingTools && !awaitingFrontendToolAnswer;
  const isRunning =
    chatHelpers.status === "submitted" ||
    chatHelpers.status === "streaming" ||
    derivedRunning;

  // Keep a non-React copy so Cmd+R / unload can stop without reading URL.
  const reasoningStartsRef = useRef(new Map<string, number>());

  useEffect(() => {
    const threadId = getThreadId?.() ?? chatHelpers.id;
    const streamId = resumableStorage.getStreamId();
    if (isRunning && isPersistableThreadId(threadId) && streamId) {
      setActiveChatRun(threadId, streamId);
      return;
    }
    if (!isRunning) clearActiveChatRun();
  }, [isRunning, chatHelpers.id, getThreadId, chatHelpers.status]);

  useEffect(() => {
    const lastAssistant = chatHelpers.messages.findLast(
      (message) => message.role === "assistant",
    );
    if (!lastAssistant) return;

    const metadata = lastAssistant.metadata as
      | { custom?: { turnTiming?: AssistantTurnTiming } }
      | undefined;
    const existing = metadata?.custom?.turnTiming;
    const suspension = findNativeToolSuspension(
      chatHelpers.messages,
      undefined,
    );
    const runId = suspension?.runId ?? existing?.runId ?? lastAssistant.id;
    const priorForRun = [...chatHelpers.messages]
      .reverse()
      .map(
        (message) =>
          (
            message.metadata as
              | { custom?: { turnTiming?: AssistantTurnTiming } }
              | undefined
          )?.custom?.turnTiming,
      )
      .find((timing) => timing?.runId === runId);
    let base = existing ?? priorForRun ?? createAssistantTurnTiming(runId);
    const now = Date.now();
    const activelyStreaming =
      chatHelpers.status === "submitted" || chatHelpers.status === "streaming";
    if (
      activelyStreaming &&
      suspension?.suspendedAt != null &&
      base.openSegment?.kind === "work" &&
      base.openSegment.startedAt <= suspension.suspendedAt
    ) {
      base = reduceAssistantTurnTiming(base, {
        type: "suspended",
        now: suspension.suspendedAt,
      });
    }
    let next =
      activelyStreaming
        ? reduceAssistantTurnTiming(base, { type: "running", runId, now })
        : suspension && awaitingFrontendToolAnswer
          ? reduceAssistantTurnTiming(base, {
              type: "suspended",
              now: suspension.suspendedAt ?? now,
            })
          : reduceAssistantTurnTiming(base, {
              type: chatHelpers.error ? "failed" : "finished",
              now,
            });

    const activeReasoningIndex =
      activelyStreaming &&
      lastAssistant.parts.at(-1)?.type === "reasoning"
        ? lastAssistant.parts.length - 1
        : -1;
    for (let index = 0; index < lastAssistant.parts.length; index += 1) {
      if (lastAssistant.parts[index]?.type !== "reasoning") continue;
      const key = reasoningSegmentKey(lastAssistant.parts, index, runId);
      const segmentIdentity = key.split(":reasoning:")[1];
      const trackerKey = `${lastAssistant.id}\0${segmentIdentity}`;
      const alreadyClosed = next.segments.some(
        (segment) =>
          segment.kind === "reasoning" &&
          segment.key.split(":reasoning:")[1] === segmentIdentity,
      );
      if (alreadyClosed) {
        reasoningStartsRef.current.delete(trackerKey);
        continue;
      }
      if (index === activeReasoningIndex) {
        if (!reasoningStartsRef.current.has(trackerKey)) {
          reasoningStartsRef.current.set(trackerKey, now);
        }
        continue;
      }
      const startedAt = reasoningStartsRef.current.get(trackerKey);
      if (startedAt == null) continue;
      reasoningStartsRef.current.delete(trackerKey);
      const endedAt = Math.max(startedAt, now);
      next = {
        ...next,
        segments: [
          ...next.segments,
          {
            key,
            kind: "reasoning",
            startedAt,
            endedAt,
            durationMs: endedAt - startedAt,
          },
        ],
      };
    }

    if (JSON.stringify(existing) === JSON.stringify(next)) return;
    chatHelpers.setMessages((current) =>
      current.map((message) =>
        message.id !== lastAssistant.id
          ? message
          : {
              ...message,
              metadata: {
                ...(message.metadata as Record<string, unknown> | undefined),
                custom: {
                  ...((message.metadata as
                    | { custom?: Record<string, unknown> }
                    | undefined)?.custom ?? {}),
                  turnTiming: next,
                },
              },
            },
      ),
    );
  }, [
    chatHelpers.status,
    chatHelpers.messages,
    chatHelpers.error,
    awaitingFrontendToolAnswer,
  ]);

  const rawMessageTiming = useMemo(() => {
    const timings: Record<string, MessageTiming> = {};
    for (const message of chatHelpers.messages) {
      if (message.role !== "assistant") continue;
      const turnTiming = (
        message.metadata as
          | { custom?: { turnTiming?: AssistantTurnTiming } }
          | undefined
      )?.custom?.turnTiming;
      if (!turnTiming) continue;
      const streamStartTime =
        turnTiming.segments[0]?.startedAt ??
        turnTiming.openSegment?.startedAt ??
        0;
      timings[message.id] = {
        streamStartTime,
        totalStreamTime: assistantTurnWorkMs(turnTiming),
        totalChunks: turnTiming.segments.length,
        toolCallCount: (message.parts ?? []).filter((part) =>
          isToolUIPart(part as never),
        ).length,
      };
    }
    return timings;
  }, [chatHelpers.messages]);
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

    // **离开页面不再掐掉这一轮。**
    //
    // 从前这里 pagehide/beforeunload 都会 POST /stop。可"刷新"恰恰是可恢复流
    // 存在的全部理由 —— 一边掐一边恢复,两个功能互相抵消:实测同一个问题不刷新
    // 答 198 字,刷新后只剩 19 字(而且开头重复),因为能恢复的只有掐掉那一刻
    // 已经产出的一截。
    //
    // 关标签页确实会因此多跑一会儿:pagehide 分不出"刷新"和"关掉"(能分辨的
    // PerformanceNavigationTiming 要等下一次加载才知道,太晚)。两害相权,
    // 保住"刷新不丢答案"这个用户能感知的承诺;真被抛弃的流有 TTL 兜底。
    const onPageHide = () => {
      flushTranscript();
    };

    const onBeforeUnload = () => {
      flushTranscript();
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

  const stampedAssistantIdsRef = useRef<Set<string>>(new Set());
  const prevChatStatusRef = useRef(chatHelpers.status);
  /** When set, auto-continue is blocked for this assistant message id (user cancelled). */
  const suppressedForAssistantIdRef = useRef<string | null>(null);

  const suppressToolContinuation = () => {
    const last = chatHelpersRef.current.messages.at(-1);
    suppressedForAssistantIdRef.current =
      last?.role === "assistant" ? last.id : null;
  };

  const clearToolContinuationSuppression = () => {
    suppressedForAssistantIdRef.current = null;
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

  /**
   * Drop tool statuses whose tool call already settled (or vanished). The tracker
   * only emits on transitions, so a run aborted mid-tool leaves an "executing"
   * entry behind forever, which pins `isRunning`.
   */
  const pruneSettledToolStatuses = () => {
    const live = new Set<string>();
    for (const message of chatHelpersRef.current.messages) {
      for (const part of message.parts ?? []) {
        if (!isToolUIPart(part as never)) continue;
        const toolPart = part as { toolCallId?: string; state?: string };
        if (
          toolPart.state === "output-available" ||
          toolPart.state === "output-error"
        ) {
          continue;
        }
        if (toolPart.toolCallId) live.add(toolPart.toolCallId);
      }
    }
    setToolStatuses((current) => {
      const next: Record<string, ToolExecutionStatus> = {};
      let changed = false;
      for (const [id, status] of Object.entries(current)) {
        if (live.has(id)) next[id] = status;
        else changed = true;
      }
      return changed ? next : current;
    });
  };

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
      if (isFrontendSuspend) {
        const suspension = findNativeToolSuspension(chat.messages, toolCallId);
        if (!suspension || suspension.toolName !== toolName) {
          throw new Error(
            `Cannot resume ${toolName}: native suspension metadata is missing`,
          );
        }
        const threadId = getThreadId?.() ?? chat.id;
        const resumeData =
          toolName === "ask_user_question" &&
          result &&
          typeof result === "object"
            ? (() => {
                const {
                  questions: _questions,
                  ...answers
                } = result as Record<string, unknown>;
                return answers;
              })()
            : result;
        const request = {
          threadId,
          runId: suspension.runId,
          toolCallId: suspension.toolCallId,
          resumeData,
        };
        stageNativeResumeRequest(request);
        try {
          resumableStorage.clear();
          await chat.sendMessage(undefined, {
            metadata: lastRunConfigRef.current,
          });
          const latestChat = chatHelpersRef.current;
          if (latestChat.status === "error" || latestChat.error) {
            throw latestChat.error ?? new Error("Native resume stream failed");
          }
        } catch (error) {
          // Keep the exact same run/tool identity retryable; never fall back to
          // replaying the full transcript as a new user turn.
          stageNativeResumeRequest(request);
          throw error;
        }
        return;
      }

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

    },
    [getThreadId],
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
        result,
        isError: options?.isError,
      }).catch((error) => {
        clearReadOpenPageSubmitted(toolCallId);
        throw error;
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
    restoredHistoryHeadRef.current = null;
    clearReadOpenPageSubmitted();
    abortAllReadOpenPageReads();
    setToolStatuses({});
    resumableStorage.clear();
    useNetworkReconnectStore.getState().clearReconnecting();
    const chat = chatHelpersRef.current;
    if (chat.status === "streaming" || chat.status === "submitted") {
      chat.stop();
    }
    return () => discardNativeResumeRequest(chatHelpers.id);
  }, [chatHelpers.id]);

  useEffect(() => {
    if (!isPersistableThreadId(resolvedThreadId)) return;
    refreshBackgroundTasksRef.current?.();
  }, [resolvedThreadId, coordinatorDispatchFingerprint]);

  useEffect(() => {
    const prev = prevChatStatusRef.current;
    prevChatStatusRef.current = chatHelpers.status;

    if (chatHelpers.status === "ready" && prev !== "ready") {
      pruneSettledToolStatuses();
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

  }, [chatHelpers.status, chatHelpers.messages]);

  useEffect(() => {
    const last = chatHelpers.messages.at(-1);
    if (last?.role !== "assistant" || !last.parts?.length) return;

    const pendingIndex = findFirstAwaitingFrontendToolIndex(last.parts);
    if (pendingIndex < 0) return;

    const pendingPart = last.parts[pendingIndex] as {
      toolCallId?: string;
      type?: string;
      input?: { mode?: 'text' | 'html'; maxChars?: number; questions?: unknown[] };
      args?: { mode?: 'text' | 'html'; maxChars?: number; questions?: unknown[] };
    };
    const toolCallId = pendingFrontendToolCallId(last, pendingIndex, pendingPart);
    const toolName = getFrontendSuspendToolName(pendingPart);
    const suspension = findNativeToolSuspension(
      chatHelpers.messages,
      pendingPart.toolCallId ?? toolCallId,
    );
    if (!suspension || suspension.toolName !== toolName) return;

    // Open the composer ask panel from message state: the inline tool UI lives
    // inside the collapsible Worked-for shell, which unmounts while collapsed.
    // Keyed by chat id — the same key the panel and the submitter bridge use.
    if (toolName === 'ask_user_question' && chatHelpers.id) {
      registerPendingAskUserSession(
        chatHelpers.id,
        last,
        pendingIndex,
        pendingPart,
      );
    }

    // Native suspension has already ended the stream; drive the desktop read and
    // resume the exact run when its result is available.
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
          stampOutgoingUserMessage(createMessage, outgoingThreadIds()),
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

    await chatHelpers.sendMessage(stampOutgoingUserMessage(createMessage, outgoingThreadIds()), {
      metadata: message.runConfig,
    });
    // A real user turn starts a fresh trajectory and clears Stop suppression.
    clearToolContinuationSuppression();
    setChatSettings({ pendingSkill: null, pendingQuote: null });
    clearPendingQuote(outgoingThreadIds());
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
            stampOutgoingUserMessage(createMessage, outgoingThreadIds()),
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
      await chatHelpers.sendMessage(stampOutgoingUserMessage(createMessage, outgoingThreadIds()), {
        metadata: message.runConfig,
      });
      setChatSettings({ pendingSkill: null, pendingQuote: null });
      clearPendingQuote(outgoingThreadIds());
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
