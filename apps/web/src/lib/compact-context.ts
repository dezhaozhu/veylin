import type { AssistantClient } from '@assistant-ui/store';
import type { ModelKey } from '@/lib/chat-settings';
import { requestChatStop } from '@/lib/chat-stop';
import { reloadThreadFromServer, type ReloadableMessage } from '@/lib/reload-thread-messages';

export type CompactContextResult =
  | { ok: true; before: number; after: number; messages: ReloadableMessage[] }
  | { ok: false; error: string };

export type CompactThreadOptions = {
  /** Optional focus instructions (Claude Code–style /compact notes). */
  instructions?: string;
};

export async function compactThreadContext(
  threadId: string,
  model: ModelKey,
  opts: CompactThreadOptions = {},
): Promise<CompactContextResult> {
  await requestChatStop(threadId).catch(() => undefined);

  const res = await fetch(
    `/api/compact?threadId=${encodeURIComponent(threadId)}&model=${encodeURIComponent(model)}`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...(opts.instructions?.trim() ? { instructions: opts.instructions.trim() } : {}),
      }),
    },
  );

  const data = (await res.json()) as CompactContextResult & {
    before?: number;
    after?: number;
    messages?: ReloadableMessage[];
    error?: string;
  };

  if (!res.ok || !data.ok || !data.messages) {
    return { ok: false, error: data.error ?? `compact failed: HTTP ${res.status}` };
  }

  return {
    ok: true,
    before: data.before ?? 0,
    after: data.after ?? data.messages.length,
    messages: data.messages,
  };
}

export async function applyCompactToThread(
  aui: AssistantClient,
  threadId: string,
  model: ModelKey,
  opts: CompactThreadOptions = {},
): Promise<CompactContextResult> {
  const result = await compactThreadContext(threadId, model, opts);
  if (!result.ok) return result;
  reloadThreadFromServer(aui, result.messages);
  return result;
}
