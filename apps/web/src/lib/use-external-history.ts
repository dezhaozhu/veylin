"use client";

import type {
  AssistantRuntime,
  ThreadHistoryAdapter,
  ThreadMessage,
  MessageFormatAdapter,
  MessageFormatRepository,
  ExportedMessageRepository,
} from "@assistant-ui/core";
import { getExternalStoreMessages } from "@assistant-ui/core";
import { MessageRepository } from "@assistant-ui/core/internal";
import { useAui, useAuiState } from "@assistant-ui/store";
import {
  useRef,
  useEffect,
  useState,
  type RefObject,
  useCallback,
  useMemo,
} from "react";
import type { UIMessage } from "ai";

import { readPendingSkillFromMessage } from '@/lib/pending-skill-message';
import { dispatchOverlayDismiss } from '@/lib/overlay-dismiss';
import { restorePendingAskUserSession } from '@/lib/restore-ask-user-session';
import {
  fetchThreadMessages,
  storedMessageToUiMessage,
} from '@/lib/server-thread-history-adapter';

function countFileParts(messages: ReadonlyArray<unknown>): number {
  return messages.reduce<number>((total, message) => {
    if (!message || typeof message !== 'object') return total;
    const parts = (message as { parts?: readonly unknown[] }).parts ?? [];
    return (
      total +
      parts.filter(
        (part) =>
          typeof part === "object" &&
          part != null &&
          (part as { type?: string }).type === "file",
      ).length
    );
  }, 0);
}

function countSkillMarkers(messages: ReadonlyArray<unknown>): number {
  return messages.reduce<number>((total, message) => {
    if (!message || typeof message !== 'object') return total;
    return total + (readPendingSkillFromMessage(message as { parts?: readonly unknown[]; metadata?: unknown }) ? 1 : 0);
  }, 0);
}

export const toExportedMessageRepository = <TMessage>(
  toThreadMessages: (messages: TMessage[]) => ThreadMessage[],
  messages: MessageFormatRepository<TMessage>,
): ExportedMessageRepository => {
  const survivingIds = new Set<string>();
  const survivors = messages.messages.flatMap((m) => {
    const message = toThreadMessages([m.message])[0];
    if (!message) {
      console.warn("Skipping a stored message that could not be loaded.");
      return [];
    }
    if (m.parentId && !survivingIds.has(m.parentId)) return [];
    survivingIds.add(message.id);
    return [{ ...m, message }];
  });

  return {
    headId:
      messages.headId && survivingIds.has(messages.headId)
        ? messages.headId
        : null,
    messages: survivors,
  };
};

export type UseExternalHistoryOptions = {
  /** Live useChat transcript length — UI reads this, not runtime.thread alone. */
  getChatMessageCount?: () => number;
};

/** Fork of useExternalHistory: wait for remoteId before marking history as loaded. */
export const useExternalHistory = <TMessage>(
  runtimeRef: RefObject<AssistantRuntime>,
  historyAdapter: ThreadHistoryAdapter | undefined,
  toThreadMessages: (messages: TMessage[]) => ThreadMessage[],
  storageFormatAdapter: MessageFormatAdapter<TMessage, any>,
  onSetMessages: (messages: TMessage[]) => void,
  options?: UseExternalHistoryOptions,
) => {
  const loadedRemoteIdRef = useRef<string | null>(null);
  const loadGenerationRef = useRef(0);

  const aui = useAui();
  const remoteId = useAuiState((s) => s.threadListItem.remoteId);
  const threadMessageCount = useAuiState((s) => s.thread.messages.length);

  const optionalThreadListItem = useCallback(
    () => (aui.threadListItem.source ? aui.threadListItem() : null),
    [aui],
  );

  const [isLoading, setIsLoading] = useState(false);

  const historyIds = useRef(new Set<string>());

  const onSetMessagesRef = useRef(onSetMessages);
  const getChatMessageCountRef = useRef(options?.getChatMessageCount);
  useEffect(() => {
    onSetMessagesRef.current = onSetMessages;
    getChatMessageCountRef.current = options?.getChatMessageCount;
  });

  const formatAdapter = useMemo(() => {
    if (!historyAdapter) return undefined;
    if (!historyAdapter.withFormat) {
      throw new Error(
        "useAISDKRuntime: ThreadHistoryAdapter is missing the required `withFormat` method.",
      );
    }
    return historyAdapter.withFormat<TMessage, any>(storageFormatAdapter);
  }, [historyAdapter, storageFormatAdapter]);

  useEffect(() => {
    if (!formatAdapter || !remoteId) return;

    const threadListItem = optionalThreadListItem();
    if (!threadListItem) return;

    const chatCount = getChatMessageCountRef.current?.() ?? 0;
    const alreadyLoadedForRemote =
      loadedRemoteIdRef.current === remoteId && chatCount > 0;
    if (alreadyLoadedForRemote) return;

    dispatchOverlayDismiss('history-load');

    const generation = ++loadGenerationRef.current;
    historyIds.current = new Set();

    const loadHistory = async () => {
      setIsLoading(true);
      try {
        const stored = await fetchThreadMessages(remoteId);
        if (generation !== loadGenerationRef.current) return;

        if (stored.length === 0) {
          loadedRemoteIdRef.current = remoteId;
          return;
        }

        const uiMessages = stored.map((msg) => storedMessageToUiMessage(msg)) as TMessage[];
        let parentId: string | null = null;
        const repo: MessageFormatRepository<TMessage> = {
          messages: uiMessages.map((message) => {
            const item = { parentId, message };
            parentId = storageFormatAdapter.getId(message);
            return item;
          }),
          ...(parentId != null ? { headId: parentId } : {}),
        };

        if (repo.messages.length === 0) {
          loadedRemoteIdRef.current = remoteId;
          return;
        }

        const converted = toExportedMessageRepository(toThreadMessages, repo);

        const tempRepo = new MessageRepository();
        tempRepo.import(converted);
        const serverMessages = tempRepo
          .getMessages()
          .flatMap(getExternalStoreMessages<TMessage>);

        const liveChatCount = getChatMessageCountRef.current?.() ?? threadMessageCount;
        const runtimeMessages = runtimeRef.current.thread
          .getState()
          .messages.flatMap(getExternalStoreMessages<TMessage>);

        const localFileParts = countFileParts(runtimeMessages);
        const serverFileParts = countFileParts(serverMessages);
        const localSkills = countSkillMarkers(runtimeMessages);
        const serverSkills = countSkillMarkers(serverMessages);

        // UI renders useChat messages. runtime.thread can retain a stale import
        // after a thread switch while chat is empty — never skip hydration then.
        if (
          liveChatCount > 0 &&
          runtimeMessages.length > 0 &&
          (uiMessages.length < runtimeMessages.length ||
            serverFileParts < localFileParts ||
            serverSkills < localSkills)
        ) {
          loadedRemoteIdRef.current = remoteId;
          return;
        }

        runtimeRef.current.thread.import(converted);
        onSetMessagesRef.current(uiMessages);
        restorePendingAskUserSession(remoteId, uiMessages as UIMessage[]);

        historyIds.current = new Set(
          converted.messages.map((m) => m.message.id),
        );
        loadedRemoteIdRef.current = remoteId;
      } catch (error) {
        console.error("Failed to load message history:", error);
      } finally {
        if (generation === loadGenerationRef.current) {
          setIsLoading(false);
        }
      }
    };

    void loadHistory();
  }, [formatAdapter, remoteId]);

  const runStartRef = useRef<number | null>(null);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepBoundariesRef = useRef<number[]>([]);
  const wasRunningRef = useRef(false);
  const toolCallCountRef = useRef(0);

  useEffect(() => {
    if (!formatAdapter) return;

    const unsubscribe = runtimeRef.current.thread.subscribe(() => {
      const { isRunning } = runtimeRef.current.thread.getState();
      const wasRunning = wasRunningRef.current;
      wasRunningRef.current = isRunning;

      if (runStartRef.current != null) {
        const lastMsg = runtimeRef.current.thread.getState().messages.at(-1);
        if (lastMsg?.role === "assistant") {
          const currentToolCallCount = lastMsg.content.filter(
            (p) => p.type === "tool-call",
          ).length;
          while (toolCallCountRef.current < currentToolCallCount) {
            stepBoundariesRef.current.push(Date.now() - runStartRef.current);
            toolCallCountRef.current++;
          }
        }
      }

      if (isRunning) {
        if (runStartRef.current == null) {
          runStartRef.current = Date.now();
          stepBoundariesRef.current = [];
          toolCallCountRef.current = 0;
        }
        if (persistTimerRef.current) {
          clearTimeout(persistTimerRef.current);
          persistTimerRef.current = null;
        }
        return;
      }

      if (!wasRunning) return;

      if (runStartRef.current != null) {
        stepBoundariesRef.current.push(Date.now() - runStartRef.current);
      }

      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      persistTimerRef.current = setTimeout(async () => {
        persistTimerRef.current = null;

        const latest = runtimeRef.current.thread.getState();
        if (latest.isRunning) return;

        const boundaries = stepBoundariesRef.current;
        const durationMs =
          boundaries.length > 0 ? boundaries.at(-1) : undefined;

        if (boundaries.length === 1 && durationMs != null) {
          const lastAssistant = latest.messages.findLast(
            (m) => m.role === "assistant",
          );
          if (lastAssistant) {
            const tcCount = lastAssistant.content.filter(
              (p) => p.type === "tool-call",
            ).length;
            if (tcCount > 0) {
              const totalSteps = tcCount + 1;
              const stepDur = durationMs / totalSteps;
              boundaries.length = 0;
              for (let i = 0; i < totalSteps; i++) {
                boundaries.push(Math.round((i + 1) * stepDur));
              }
            }
          }
        }

        const stepTimestamps =
          boundaries.length > 1
            ? boundaries.map((endMs, i) => ({
                start_ms: i === 0 ? 0 : boundaries[i - 1]!,
                end_ms: endMs,
              }))
            : undefined;

        runStartRef.current = null;
        stepBoundariesRef.current = [];

        const telemetryOptions = {
          ...(durationMs != null ? { durationMs } : undefined),
          ...(stepTimestamps != null ? { stepTimestamps } : undefined),
        };

        const { messages } = latest;
        let lastInnerMessageId: string | null = null;

        const getLastInnerId = (msgs: TMessage[]): string | null =>
          msgs.length > 0 ? storageFormatAdapter.getId(msgs.at(-1)!) : null;

        const toBatchItems = (msgs: TMessage[]) =>
          msgs.map((msg, idx) => ({
            parentId:
              idx === 0
                ? lastInnerMessageId
                : storageFormatAdapter.getId(msgs[idx - 1]!),
            message: msg,
          }));

        for (const message of messages) {
          const innerMessages = getExternalStoreMessages<TMessage>(message);

          const isReady =
            message.status === undefined ||
            message.status.type === "complete" ||
            message.status.type === "incomplete";

          if (!isReady) {
            lastInnerMessageId =
              getLastInnerId(innerMessages) ?? lastInnerMessageId;
            continue;
          }

          if (historyIds.current.has(message.id)) {
            if (durationMs !== undefined) {
              let parentId = lastInnerMessageId;
              for (const innerMessage of innerMessages) {
                try {
                  await formatAdapter.update?.(
                    { parentId, message: innerMessage },
                    storageFormatAdapter.getId(innerMessage),
                  );
                } catch {
                  // ignore update failures
                }
                parentId = storageFormatAdapter.getId(innerMessage);
              }
            }
            lastInnerMessageId =
              getLastInnerId(innerMessages) ?? lastInnerMessageId;
            continue;
          }
          historyIds.current.add(message.id);

          const batchItems = toBatchItems(innerMessages);
          for (const item of batchItems) {
            try {
              await formatAdapter.append(item);
            } catch (err) {
              console.warn("[history] append failed", err);
            }
          }

          lastInnerMessageId =
            getLastInnerId(innerMessages) ?? lastInnerMessageId;

          formatAdapter.reportTelemetry?.(batchItems, telemetryOptions);
        }
      }, 0);
    });

    return () => {
      unsubscribe();
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    };
  }, [formatAdapter, storageFormatAdapter, runtimeRef]);

  const deleteMessage = useCallback(
    async (messageId: string) => {
      if (!formatAdapter?.delete) return;

      const messages = runtimeRef.current.thread.getState().messages;
      const messageIndex = messages.findIndex((m) => m.id === messageId);
      if (messageIndex === -1) return;

      const previousInnerMessages = messages
        .slice(0, messageIndex)
        .flatMap(getExternalStoreMessages<TMessage>);
      let parentId = previousInnerMessages.at(-1)
        ? storageFormatAdapter.getId(previousInnerMessages.at(-1)!)
        : null;
      const itemsToDelete = getExternalStoreMessages<TMessage>(
        messages[messageIndex]!,
      ).map((message) => {
        const item = { parentId, message };
        parentId = storageFormatAdapter.getId(message);
        return item;
      });

      await formatAdapter.delete(itemsToDelete);

      historyIds.current.delete(messageId);
    },
    [formatAdapter, runtimeRef, storageFormatAdapter],
  );

  return { isLoading, deleteMessage };
};
