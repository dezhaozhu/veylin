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
import { useEffect, useMemo, useRef } from 'react';
import { createServerThreadListAdapter } from './server-thread-list-adapter';
import { useAISDKRuntimeWithQueue } from './use-aisdk-runtime-with-queue';
import { resumableStorage } from './resumable-storage';
import { isBenignChatError } from './format-chat-error';
import { useNetworkReconnectStore } from './network-reconnect-store';

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
    resume,
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
  const chat = useChat({
    ...chatOptions,
    id,
    transport,
    resume,
  });

  const runtime = useAISDKRuntimeWithQueue(chat, {
    adapters,
    ...pickExternalStoreSharedOptions(options ?? {}),
    ...(toCreateMessage && { toCreateMessage }),
    ...(onResume && { onResume }),
    ...(joinStrategy && { joinStrategy }),
    getThreadId: () => remoteId ?? id,
  });

  if (transport instanceof AssistantChatTransport) {
    transport.setRuntime(runtime);
    transport.__internal_setGetThreadListItem(() =>
      aui.threadListItem.source ? aui.threadListItem() : undefined,
    );
  }

  const resumeFiredRef = useRef(false);

  useEffect(() => {
    resumeFiredRef.current = false;
  }, [id]);

  useEffect(() => {
    if (resumeFiredRef.current) return;
    const pending = resumableStorage.getStreamId();
    if (!pending) return;

    // Stale stream ids on empty threads (e.g. new chat) must not trigger resume.
    if (chat.messages.length === 0) {
      resumableStorage.clear();
      useNetworkReconnectStore.getState().clearReconnecting();
      return;
    }

    resumeFiredRef.current = true;
    chat.resumeStream().catch((err: unknown) => {
      if (isBenignChatError(err)) {
        resumableStorage.clear();
        useNetworkReconnectStore.getState().clearReconnecting();
        return;
      }
      console.warn('[chat] resume failed; clearing stored stream id', err);
      resumableStorage.clear();
      useNetworkReconnectStore.getState().clearReconnecting();
    });
  }, [chat, id]);

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
