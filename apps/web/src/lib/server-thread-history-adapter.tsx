'use client';

import { type FC, type PropsWithChildren, useMemo, useState } from 'react';
import type {
  GenericThreadHistoryAdapter,
  MessageFormatAdapter,
  MessageFormatItem,
  MessageFormatRepository,
  ThreadHistoryAdapter,
} from '@assistant-ui/core';
import type { ExportedMessageRepositoryItem } from '@assistant-ui/core/internal';
import { RuntimeAdapterProvider } from '@assistant-ui/core/react';
import { type AssistantClient, useAui } from '@assistant-ui/store';
import { generateId, type UIMessage } from 'ai';
import { extractSentAtFromParts, stampMessageWithSentAt } from '@/lib/message-timestamp';
import { isObsoleteUiMessagePart } from '@veylin/shared';

type StoredUiMessage = {
  id?: string;
  role: string;
  content?: string;
  parts?: unknown[];
};

async function fetchThreadMessages(remoteId: string): Promise<StoredUiMessage[]> {
  const res = await fetch(`/api/threads/${encodeURIComponent(remoteId)}/messages`, {
    credentials: 'include',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  const data = (await res.json()) as { messages?: StoredUiMessage[] };
  return data.messages ?? [];
}

function normalizePart(part: unknown): unknown {
  if (!part || typeof part !== 'object') return part;
  const p = part as Record<string, unknown>;

  if (p.type === 'reasoning') {
    const details = Array.isArray(p.details) ? p.details : [];
    const textFromDetails = details
      .filter((d): d is { type?: string; text?: string } => typeof d === 'object' && d != null)
      .filter((d) => d.type === 'text')
      .map((d) => d.text ?? '')
      .join('');
    const text =
      typeof p.text === 'string'
        ? p.text
        : typeof p.reasoning === 'string' && p.reasoning
          ? p.reasoning
          : textFromDetails;
    return { type: 'reasoning', text: text || textFromDetails || '' };
  }

  if (p.type === 'text') {
    return { ...p, text: typeof p.text === 'string' ? p.text : String(p.text ?? '') };
  }

  return part;
}

export function storedMessageToUiMessage(msg: StoredUiMessage): UIMessage {
  const rawParts =
    msg.parts && msg.parts.length > 0
      ? msg.parts
      : msg.content
        ? [{ type: 'text' as const, text: msg.content }]
        : [];
  const parts = rawParts.map(normalizePart).filter((part) => {
    if (!part || typeof part !== 'object') return false;
    if (isObsoleteUiMessagePart(part)) return false;
    const p = part as { type?: string; text?: string };
    if (p.type === 'data-veylin-pendingSkill') return true;
    if (p.type === 'text' || p.type === 'reasoning') {
      return (p.text ?? '').trim().length > 0;
    }
    return true;
  });
  const sentAt = extractSentAtFromParts(rawParts);
  const uiMessage: UIMessage = {
    id: msg.id ?? generateId(),
    role: msg.role as UIMessage['role'],
    parts: parts as UIMessage['parts'],
  };
  return sentAt != null ? stampMessageWithSentAt(uiMessage, sentAt) : uiMessage;
}

class ServerThreadHistoryAdapter implements ThreadHistoryAdapter {
  constructor(private aui: AssistantClient) {}

  private async resolveRemoteId(): Promise<string | undefined> {
    const state = this.aui.threadListItem().getState();
    if (state.remoteId) return state.remoteId;
    const init = await this.aui.threadListItem().initialize();
    return init.remoteId;
  }

  withFormat<TMessage, TStorageFormat extends Record<string, unknown>>(
    formatAdapter: MessageFormatAdapter<TMessage, TStorageFormat>,
  ): GenericThreadHistoryAdapter<TMessage> {
    const adapter = this;
    return {
      async load(): Promise<MessageFormatRepository<TMessage>> {
        const remoteId = await adapter.resolveRemoteId();
        if (!remoteId) return { messages: [] };

        const stored = await fetchThreadMessages(remoteId);
        let parentId: string | null = null;
        const messages: MessageFormatItem<TMessage>[] = stored.map((msg) => {
          const uiMessage = storedMessageToUiMessage(msg) as TMessage;
          const item: MessageFormatItem<TMessage> = { parentId, message: uiMessage };
          parentId = formatAdapter.getId(uiMessage);
          return item;
        });

        return {
          messages,
          ...(parentId != null ? { headId: parentId } : {}),
        };
      },

      // Mastra persists messages during /api/chat; no duplicate writes needed.
      async append(_item: MessageFormatItem<TMessage>): Promise<void> {},

      async delete(_items: MessageFormatItem<TMessage>[]): Promise<void> {},
    };
  }

  async load() {
    return { messages: [] as ExportedMessageRepositoryItem[] };
  }

  async append(_item: ExportedMessageRepositoryItem): Promise<void> {}
}

export function useServerThreadHistoryAdapter(): ThreadHistoryAdapter {
  const aui = useAui();
  const [adapter] = useState(() => new ServerThreadHistoryAdapter(aui));
  return adapter;
}

export function ServerThreadHistoryProvider({ children }: PropsWithChildren) {
  const history = useServerThreadHistoryAdapter();
  const adapters = useMemo(() => ({ history }), [history]);

  return (
    <RuntimeAdapterProvider adapters={adapters}>{children}</RuntimeAdapterProvider>
  );
}

export function createServerThreadHistoryProvider(): FC<PropsWithChildren> {
  return ServerThreadHistoryProvider;
}
