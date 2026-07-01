import { createAssistantStream } from 'assistant-stream';
import type { RemoteThreadListAdapter, ThreadMessage } from '@assistant-ui/core';
import { createServerThreadHistoryProvider } from './server-thread-history-adapter';

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...init });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json() as Promise<T>;
}

/** Server-backed thread list: persists titles and lists sessions via the local API (SurrealDB). */
export function createServerThreadListAdapter(): RemoteThreadListAdapter {
  return {
    unstable_Provider: createServerThreadHistoryProvider(),

    async list() {
      const data = await apiJson<{
        threads: {
          remoteId: string;
          title?: string;
          lastMessageAt?: string;
          status: 'regular' | 'archived';
        }[];
      }>('/api/threads');
      return {
        threads: data.threads.map((t) => ({
          ...t,
          lastMessageAt: t.lastMessageAt ? new Date(t.lastMessageAt) : undefined,
        })),
      };
    },

    async initialize(threadId: string) {
      await apiJson(`/api/threads/${encodeURIComponent(threadId)}/initialize`, {
        method: 'POST',
      });
      return { remoteId: threadId, externalId: undefined };
    },

    async rename(remoteId: string, newTitle: string) {
      await apiJson(`/api/threads/${encodeURIComponent(remoteId)}/title`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: newTitle }),
      });
    },

    async archive(remoteId: string) {
      await apiJson(`/api/threads/${encodeURIComponent(remoteId)}`, {
        method: 'DELETE',
      });
    },

    async unarchive() {},

    async delete(remoteId: string) {
      await apiJson(`/api/threads/${encodeURIComponent(remoteId)}`, { method: 'DELETE' });
    },

    async fetch(threadId: string) {
      const data = await apiJson<{
        remoteId: string;
        title?: string;
        lastMessageAt?: string;
        status: 'regular' | 'archived';
      }>(`/api/threads/${encodeURIComponent(threadId)}`);
      return {
        ...data,
        lastMessageAt: data.lastMessageAt ? new Date(data.lastMessageAt) : undefined,
      };
    },

    async generateTitle(remoteId: string, messages: readonly ThreadMessage[]) {
      const data = await apiJson<{ title: string }>(
        `/api/threads/${encodeURIComponent(remoteId)}/generate-title`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ messages }),
        },
      );
      return createAssistantStream((controller) => {
        controller.appendText(data.title);
      });
    },
  };
}
