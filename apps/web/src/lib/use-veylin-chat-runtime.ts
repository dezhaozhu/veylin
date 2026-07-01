'use client';

import { useChat, type UIMessage } from '@ai-sdk/react';
import {
  pickExternalStoreSharedOptions,
  type AssistantRuntime,
} from '@assistant-ui/core';
import { useRemoteThreadListRuntime } from '@assistant-ui/react';
import { useAui, useAuiState } from '@assistant-ui/store';
import {
  AssistantChatTransport,
  type UseChatRuntimeOptions,
} from '@assistant-ui/react-ai-sdk';
import type { ChatTransport } from 'ai';
import { useEffect, useMemo, useRef, useCallback } from 'react';
import { createServerThreadListAdapter } from './server-thread-list-adapter';
import { isPersistableThreadId, syncThreadMessagesToServer } from './sync-thread-messages';
import { useAISDKRuntimeWithQueue } from './use-aisdk-runtime-with-queue';
import { resumableStorage } from './resumable-storage';
import { isBenignChatError } from './format-chat-error';
import { useNetworkReconnectStore } from './network-reconnect-store';
import { conversationAwaitsResume } from './frontend-suspend-tools';

const useDynamicChatTransport = <UI_MESSAGE extends UIMessage = UIMessage>(
  transport: ChatTransport<UI_MESSAGE>,
): ChatTransport<UI_MESSAGE> => {
  const transportRef = useRef(transport);
  useEffect(() => {
    transportRef.current = transport;
  });
  return useMemo(
    () =>
      new Proxy(transportRef.current, {
        get(_, prop) {
          const res =
            transportRef.current[prop as keyof ChatTransport<UI_MESSAGE>];
          return typeof res === 'function'
            ? res.bind(transportRef.current)
            : res;
        },
      }),
    [],
  );
};

function useChatThreadRuntime<UI_MESSAGE extends UIMessage = UIMessage>(
  options?: UseChatRuntimeOptions<UI_MESSAGE> & { resume?: boolean },
): AssistantRuntime {
  const {
    adapters,
    transport: transportOptions,
    toCreateMessage,
    onResume,
    joinStrategy,
    resume: resumeStreams = false,
    onFinish: userOnFinish,
    cloud: _cloud,
    ...chatOptions
  } = options ?? {};

  const transport = useDynamicChatTransport(
    transportOptions ?? new AssistantChatTransport(),
  );

  const id = useAuiState((s) => s.threadListItem.id);
  const remoteId = useAuiState(
    (s) => s.threadListItem.remoteId ?? s.threadListItem.externalId,
  );
  const aui = useAui();
  const ensureThreadInitialized = useCallback(async (): Promise<string | undefined> => {
    const state = aui.threadListItem().getState();
    if (state.remoteId) return state.remoteId;
    const init = await aui.threadListItem().initialize();
    return init.remoteId;
  }, [aui]);

  const chat = useChat({
    ...chatOptions,
    id,
    transport,
    // Resume is gated below (activity + stale stream cleanup). Unconditional
    // resume on mount reconnects dead streams and freezes the UI after refresh.
    resume: false,
    onFinish: (...args) => {
      const event = args[0];
      const threadId = remoteId ?? id;
      if (isPersistableThreadId(threadId) && event && !event.isAbort && event.messages?.length) {
        void syncThreadMessagesToServer(threadId, event.messages);
      }
      userOnFinish?.(...args);
    },
  });

  const getThreadId = useCallback(() => remoteId ?? id, [remoteId, id]);

  const runtime = useAISDKRuntimeWithQueue(chat, {
    adapters,
    ...pickExternalStoreSharedOptions(options ?? {}),
    ...(toCreateMessage && { toCreateMessage }),
    ...(onResume && { onResume }),
    ...(joinStrategy && { joinStrategy }),
    getThreadId,
    ensureThreadInitialized,
  });

  if (transport instanceof AssistantChatTransport) {
    transport.setRuntime(runtime);
    transport.__internal_setGetThreadListItem(() => aui.threadListItem());
  }

  const resumeFiredRef = useRef(false);
  const chatRef = useRef(chat);
  chatRef.current = chat;

  // Only react to thread id changes — `chat` from useChat is a new object every
  // render; including it re-ran this effect for every alive thread on each parent
  // re-render, clearing the global resumable stream id and freezing the UI.
  useEffect(() => {
    resumeFiredRef.current = false;
    resumableStorage.clear();
    useNetworkReconnectStore.getState().clearBanner();
    const current = chatRef.current;
    current.clearError();
    if (current.status === "streaming" || current.status === "submitted") {
      current.stop();
    }
  }, [id]);

  useEffect(() => {
    if (!resumeStreams) return;
    if (resumeFiredRef.current) return;
    const pending = resumableStorage.getStreamId();
    if (!pending) return;

    // Stale stream ids on empty threads (e.g. new chat) must not trigger resume.
    if (chat.messages.length === 0) {
      resumableStorage.clear();
      useNetworkReconnectStore.getState().clearBanner();
      chat.clearError();
      return;
    }

    resumeFiredRef.current = true;
    const threadId = remoteId ?? id;

    // A finished conversation is not resumable. The server's `activity === 'running'`
    // signal can be stale (lingering active-stream mapping within its TTL, or a
    // non-terminal background task row), so the visible message state is the final
    // authority: only re-attach when the latest turn is genuinely mid-flight.
    if (!conversationAwaitsResume(chat.messages)) {
      resumableStorage.clear();
      useNetworkReconnectStore.getState().clearBanner();
      chat.clearError();
      return;
    }

    void (async () => {
      try {
        const activityRes = await fetch('/api/threads/activity', {
          credentials: 'include',
        });
        if (activityRes.ok) {
          const data = (await activityRes.json()) as {
            activity?: Record<string, { kind?: string }>;
          };
          if (data.activity?.[threadId]?.kind !== 'running') {
            resumableStorage.clear();
            useNetworkReconnectStore.getState().clearBanner();
            chat.clearError();
            if (chat.status === 'streaming' || chat.status === 'submitted') {
              chat.stop();
            }
            return;
          }
        }
        await chat.resumeStream();
      } catch (err: unknown) {
        if (isBenignChatError(err)) {
          resumableStorage.clear();
          useNetworkReconnectStore.getState().clearBanner();
          chat.clearError();
          return;
        }
        console.warn('[chat] resume failed; clearing stored stream id', err);
        resumableStorage.clear();
        useNetworkReconnectStore.getState().clearBanner();
        chat.clearError();
      }
    })();
  }, [chat, id, remoteId, resumeStreams]);

  return runtime;
}

/** Chat runtime with server-backed thread list and auto title generation. */
export function useVeylinChatRuntime<UI_MESSAGE extends UIMessage = UIMessage>(
  options: Omit<UseChatRuntimeOptions<UI_MESSAGE>, 'cloud'> & { resume?: boolean } = {},
): AssistantRuntime {
  const adapter = useMemo(() => createServerThreadListAdapter(), []);
  return useRemoteThreadListRuntime({
    runtimeHook: function RuntimeHook() {
      return useChatThreadRuntime(options);
    },
    adapter,
    allowNesting: true,
  });
}
