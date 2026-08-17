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
import {
  fetchThreadMessages,
  storedMessageToUiMessage,
} from '@/lib/server-thread-history-adapter';
import {
  clearHistoryLoadError,
  setHistoryLoadError,
  setHistoryLoadRetry,
} from '@/lib/history-load-state';
import {
  assistantTurnWorkMs,
  type AssistantTurnTiming,
} from '@/lib/assistant-turn-timing';

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
  /** Last remoteId we finished a fetch for (success, empty, or error) — blocks spin loops. */
  const attemptedRemoteIdRef = useRef<string | null>(null);
  const loadGenerationRef = useRef(0);
  const reloadNonceRef = useRef(0);
  const [reloadNonce, setReloadNonce] = useState(0);
  const wasMainRef = useRef(false);

  const aui = useAui();
  const remoteId = useAuiState((s) => s.threadListItem.remoteId);
  const threadTitle = useAuiState((s) => s.threadListItem.title);
  const threadStatus = useAuiState((s) => s.threadListItem.status);
  const isMainThread = useAuiState(
    (s) => s.threads.mainThreadId === s.threadListItem.id,
  );

  const optionalThreadListItem = useCallback(
    () => (aui.threadListItem.source ? aui.threadListItem() : null),
    [aui],
  );

  const [isLoading, setIsLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

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

  const reloadHistory = useCallback(() => {
    loadedRemoteIdRef.current = null;
    attemptedRemoteIdRef.current = null;
    reloadNonceRef.current += 1;
    setReloadNonce(reloadNonceRef.current);
  }, []);

  useEffect(() => {
    if (!isMainThread || !remoteId) {
      setHistoryLoadRetry(null);
      return;
    }
    setHistoryLoadRetry(() => {
      clearHistoryLoadError(remoteId);
      setHistoryError(null);
      reloadHistory();
    });
    return () => setHistoryLoadRetry(null);
  }, [isMainThread, remoteId, reloadHistory]);

  useEffect(() => {
    if (!formatAdapter || !remoteId) return;

    const threadListItem = optionalThreadListItem();
    if (!threadListItem) return;

    const becameMain = isMainThread && !wasMainRef.current;
    wasMainRef.current = isMainThread;

    const chatCount = getChatMessageCountRef.current?.() ?? 0;
    if (loadedRemoteIdRef.current === remoteId && chatCount > 0) return;

    // After a finished attempt (empty or error), only retry when activated again
    // or the user explicitly reloads — never spin while staying on the same thread.
    if (attemptedRemoteIdRef.current === remoteId && !becameMain && reloadNonce === 0) {
      return;
    }

    dispatchOverlayDismiss('history-load');

    const generation = ++loadGenerationRef.current;
    historyIds.current = new Set();

    const loadHistory = async () => {
      setIsLoading(true);
      setHistoryError(null);
      clearHistoryLoadError(remoteId);
      try {
        const stored = await fetchThreadMessages(remoteId);
        if (generation !== loadGenerationRef.current) return;

        attemptedRemoteIdRef.current = remoteId;

        if (stored.length === 0) {
          // Soft-mark: blocks spin via attemptedRemoteId; activation can retry.
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

        const liveChatCount = getChatMessageCountRef.current?.() ?? 0;
        const runtimeMessages = runtimeRef.current.thread
          .getState()
          .messages.flatMap(getExternalStoreMessages<TMessage>);

        const localFileParts = countFileParts(runtimeMessages);
        const serverFileParts = countFileParts(serverMessages);
        const localSkills = countSkillMarkers(runtimeMessages);
        const serverSkills = countSkillMarkers(serverMessages);

        // UI renders useChat messages. Never skip when useChat is empty.
        const shouldSkipHydration =
          liveChatCount > 0 &&
          runtimeMessages.length > 0 &&
          (uiMessages.length < runtimeMessages.length ||
            serverFileParts < localFileParts ||
            serverSkills < localSkills);

        if (shouldSkipHydration) {
          loadedRemoteIdRef.current = remoteId;
          return;
        }

        runtimeRef.current.thread.import(converted);
        // The pending ask panel is re-opened by the chat runtime once these
        // messages land — it keys the session by chat id, as the panel does.
        onSetMessagesRef.current(uiMessages);

        historyIds.current = new Set(
          converted.messages.map((m) => m.message.id),
        );
        loadedRemoteIdRef.current = remoteId;
      } catch (error) {
        console.error("Failed to load message history:", error);
        if (generation === loadGenerationRef.current) {
          attemptedRemoteIdRef.current = remoteId;
          // Do not set loadedRemoteIdRef — chat stays empty and Retry/activation works.
          const message =
            error instanceof Error ? error.message : "Failed to load message history";
          setHistoryError(message);
          if (isMainThread) setHistoryLoadError(remoteId, message);
        }
      } finally {
        if (generation === loadGenerationRef.current) {
          setIsLoading(false);
        }
      }
    };

    void loadHistory();
  }, [
    formatAdapter,
    remoteId,
    isMainThread,
    reloadNonce,
    threadTitle,
    threadStatus,
    optionalThreadListItem,
    runtimeRef,
    storageFormatAdapter,
    toThreadMessages,
  ]);

  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasRunningRef = useRef(false);

  useEffect(() => {
    if (!formatAdapter) return;

    const unsubscribe = runtimeRef.current.thread.subscribe(() => {
      const { isRunning } = runtimeRef.current.thread.getState();
      const wasRunning = wasRunningRef.current;
      wasRunningRef.current = isRunning;

      if (isRunning) {
        if (persistTimerRef.current) {
          clearTimeout(persistTimerRef.current);
          persistTimerRef.current = null;
        }
        return;
      }

      if (!wasRunning) return;

      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      persistTimerRef.current = setTimeout(async () => {
        persistTimerRef.current = null;

        const latest = runtimeRef.current.thread.getState();
        if (latest.isRunning) return;

        const lastAssistant = latest.messages.findLast(
          (message) => message.role === "assistant",
        );
        const turnTiming = (
          lastAssistant as
            | { metadata?: { custom?: { turnTiming?: AssistantTurnTiming } } }
            | undefined
        )?.metadata?.custom?.turnTiming;
        const durationMs = assistantTurnWorkMs(turnTiming);
        const workDurations =
          turnTiming?.segments
            .filter((segment) => segment.kind === "work")
            .map((segment) => segment.durationMs) ?? [];
        const closedWorkMs = workDurations.reduce(
          (sum, duration) => sum + duration,
          0,
        );
        if (durationMs != null && durationMs > closedWorkMs) {
          workDurations.push(durationMs - closedWorkMs);
        }
        let cumulativeWorkMs = 0;
        const stepTimestamps =
          workDurations.length > 1
            ? workDurations.map((duration) => {
                const start_ms = cumulativeWorkMs;
                cumulativeWorkMs += duration;
                return { start_ms, end_ms: cumulativeWorkMs };
              })
            : undefined;

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
      }, 50);
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

  return { isLoading, historyError, reloadHistory, deleteMessage };
};
