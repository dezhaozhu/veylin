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
import { toCreateMessage } from "../../../../node_modules/@assistant-ui/react-ai-sdk/src/ui/utils/toCreateMessage";
import { vercelAttachmentAdapter } from "../../../../node_modules/@assistant-ui/react-ai-sdk/src/ui/utils/vercelAttachmentAdapter";
import { AISDKMessageConverter } from "../../../../node_modules/@assistant-ui/react-ai-sdk/src/ui/utils/convertMessage";
import { wrapModelContentEnvelope } from "../../../../node_modules/@assistant-ui/react-ai-sdk/src/modelContentEnvelope";
import {
  type AISDKStorageFormat,
  aiSDKV6FormatAdapter,
} from "../../../../node_modules/@assistant-ui/react-ai-sdk/src/ui/adapters/aiSDKFormatAdapter";
import {
  sliceMessagesUntil,
} from "../../../../node_modules/@assistant-ui/react-ai-sdk/src/ui/utils/sliceMessagesUntil";
import { sliceMessagesForLinearEdit } from "./slice-messages-for-linear-edit";
import {
  useExternalHistory,
  toExportedMessageRepository,
} from './use-external-history';
import { useStreamingTiming } from "../../../../node_modules/@assistant-ui/react-ai-sdk/src/ui/use-chat/useStreamingTiming";
import { stampMessageWithSentAt } from "./message-timestamp";
import { stampOutgoingUserMessage } from "./pending-skill-message";
import { createMessageQueueWithDrafts } from "./create-message-queue-with-drafts";
import { setComposerQueueRuntime } from "./composer-queue-runtime";
import { getChatSettings, setChatSettings } from "./chat-settings";
import { setForceReplaceNextChat } from "./chat-force-replace-ref";
import { stripAllPendingSkillTokens } from "./pending-skill-text";
import { requestChatStop } from "./chat-stop";
import { resumableStorage } from "./resumable-storage";
import { useNetworkReconnectStore } from "./network-reconnect-store";
import {
  findFirstAwaitingFrontendToolIndex,
  FRONTEND_SUSPEND_TOOL_NAMES,
  isAwaitingFrontendToolAnswer,
  pendingFrontendToolCallId,
  registerFrontendToolStop,
  registerStreamStop,
  shouldAutoSendChat,
  trimAssistantAfterAwaitingTool,
} from "./frontend-suspend-tools";
import {
  createFrontendToolContinuationController,
  createToolContinuationAttemptTracker,
  markToolContinuationAttempt,
  requestFrontendToolContinuation,
  resetFrontendToolContinuationController,
  resetToolContinuationAttemptTracker,
  toolContinuationFingerprint,
  tryContinueFrontendToolChat,
  unmarkToolContinuationAttempt,
} from "./frontend-tool-continuation";
import { registerAskUserResultSubmitter } from "./ask-user-submit-bridge";
import {
  isThreadMessageInput,
  resolveThreadMessagesToUi,
} from "./resolve-branch-ui-messages";
import { isPersistableThreadId, syncThreadMessagesToServer } from "./sync-thread-messages";

export type CustomToCreateMessageFunction = <
  UI_MESSAGE extends UIMessage = UIMessage,
>(
  message: AppendMessage,
) => CreateUIMessage<UI_MESSAGE>;

const toUIMessage = <UI_MESSAGE extends UIMessage>(
  createMessage: CreateUIMessage<UI_MESSAGE>,
  fallbackRole: UI_MESSAGE["role"],
): UI_MESSAGE =>
  ({
    ...createMessage,
    id: createMessage.id ?? generateId(),
    role: createMessage.role ?? fallbackRole,
  }) as UI_MESSAGE;

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
  const isRunning =
    chatHelpers.status === "submitted" ||
    chatHelpers.status === "streaming" ||
    hasExecutingTools ||
    awaitingFrontendToolAnswer;

  const messageTiming = useStreamingTiming(chatHelpers.messages, isRunning);

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
        ...(chatHelpers.error && { error: chatHelpers.error.message }),
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
      chatHelpers.setMessages(messages);
    },
  );

  const completePendingToolCalls = async () => {
    if (!cancelPendingToolCallsOnSend) return;

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
          errorText: "User cancelled tool call by sending a new message.",
        };
      });

      if (!hasChanges) return messages;
      return [...messages.slice(0, -1), { ...lastMessage, parts }];
    });
  };

  const chatHelpersRef = useRef(chatHelpers);
  chatHelpersRef.current = chatHelpers;

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
              chatHelpersRef.current.stop();
              const threadId = chatHelpersRef.current.id;
              if (threadId) {
                try {
                  await requestChatStop(threadId);
                } catch (err) {
                  console.warn("[chat] steer stop failed", err);
                }
              }
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

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushTranscript();
    };

    window.addEventListener('beforeunload', flushTranscript);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', flushTranscript);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [getThreadId]);

  const stoppedFrontendToolIdsRef = useRef<Set<string>>(new Set());
  const stampedAssistantIdsRef = useRef<Set<string>>(new Set());
  const frontendContinuationRef = useRef(createFrontendToolContinuationController());
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
      const custom = (last.metadata as { custom?: { sentAt?: number } } | undefined)
        ?.custom;
      if (typeof custom?.sentAt === "number") return current;
      stampedAssistantIdsRef.current.add(last.id);
      return [...current.slice(0, -1), stampMessageWithSentAt(last)];
    });
  };

  const interruptChatRun = () => {
    suppressToolContinuation();
    useNetworkReconnectStore.getState().clearBanner();
    const streamId = resumableStorage.getStreamId();
    chatHelpersRef.current.stop();
    setToolStatuses({});
    finalizeInterruptedAssistant();
    const threadId = getThreadId?.() ?? chatHelpersRef.current.id;
    if (threadId) {
      void requestChatStop(threadId, { activeStreamId: streamId }).catch((err) => {
        console.warn("[chat] interrupt stop failed", err);
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
      sendMessage: () =>
        chatHelpersRef.current.sendMessage(undefined, {
          metadata: lastRunConfigRef.current,
        }),
      onSendFailed: () => {
        resetToolContinuationAttemptTracker(toolContinuationAttemptRef.current);
      },
    });
  };

  const scheduleToolContinuationIfNeeded = () => {
    const messages = chatHelpersRef.current.messages;
    const status = chatHelpersRef.current.status;
    if (status !== "ready") return;
    if (isToolContinuationSuppressed(messages)) return;
    if (!shouldAutoSendChat({ messages, status: "ready" })) return;

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
    return () => registerAskUserResultSubmitter(threadId, null);
  }, [applyToolResult, chatHelpers.id]);

  useEffect(() => {
    const prev = prevChatStatusRef.current;
    prevChatStatusRef.current = chatHelpers.status;

    if (chatHelpers.status === "ready" && prev !== "ready") {
      frontendContinuationRef.current.sendStarted = false;
    }

    scheduleToolContinuationIfNeeded();
  }, [chatHelpers.status, chatHelpers.messages]);

  useEffect(() => {
    const last = chatHelpers.messages.at(-1);
    if (last?.role !== "assistant" || !last.parts?.length) return;

    const pendingIndex = findFirstAwaitingFrontendToolIndex(last.parts);
    if (pendingIndex < 0) return;

    const pendingPart = last.parts[pendingIndex] as { toolCallId?: string; type?: string };
    const toolCallId = pendingFrontendToolCallId(last, pendingIndex, pendingPart);
    if (!stoppedFrontendToolIdsRef.current.has(toolCallId)) {
      stoppedFrontendToolIdsRef.current.add(toolCallId);
      const stopIds = [toolCallId];
      if (pendingPart.toolCallId && pendingPart.toolCallId !== toolCallId) {
        stopIds.push(pendingPart.toolCallId);
      }
      stopFrontendToolStream("open", stopIds);
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

    clearToolContinuationSuppression();
    lastRunConfigRef.current = message.runConfig;
    await completePendingToolCalls();
    await chatHelpers.sendMessage(stampOutgoingUserMessage(createMessage), {
      metadata: message.runConfig,
    });
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
      setForceReplaceNextChat(true);
      lastRunConfigRef.current = message.runConfig;
      await completePendingToolCalls();
      const sliced = sliceMessagesForLinearEdit(
        chatHelpers.messages,
        message.sourceId,
        message.parentId,
      );
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
