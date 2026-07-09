import type { Memory } from '@mastra/memory';
import {
  ensureMastraThread,
  mastraMessagesToUi,
  mastraMessagesToAgentContext,
  preserveServerTaskNotifications,
  mergeAgentContextMessages,
  replaceThreadMessages,
  type ThreadIdentity,
  type UiMessage,
} from './message-sync';
import {
  setTodos as setThreadTodosDb,
  todosFromMessageHistory,
} from './thread-state';
import type { TodoItem } from '@veylin/tools';
import { isDatastoreFailure } from './store-errors';

/**
 * After a client transcript replace (edit truncate / forceReplace), todos must
 * match the last todo_write still present — or clear when none remain.
 */
export function resolveTodosForReplacedTranscript(messages: UiMessage[]): TodoItem[] {
  return todosFromMessageHistory(messages) ?? [];
}

type StoredMessage = { id?: string; role?: string };

const syncLocks = new Map<string, Promise<unknown>>();

function withThreadSyncLock<T>(threadId: string, run: () => Promise<T>): Promise<T> {
  const prev = syncLocks.get(threadId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(run);
  syncLocks.set(
    threadId,
    next.finally(() => {
      if (syncLocks.get(threadId) === next) syncLocks.delete(threadId);
    }),
  );
  return next;
}

export function isMemoryStoreFailure(err: unknown): boolean {
  return isDatastoreFailure(err);
}

function messageIds(messages: Array<{ id?: string }>): string[] {
  return messages.map((m) => m.id).filter((id): id is string => Boolean(id));
}

function sharedPrefixLength(storedIds: string[], clientIds: string[]): number {
  const limit = Math.min(storedIds.length, clientIds.length);
  let i = 0;
  while (i < limit && storedIds[i] === clientIds[i]) i++;
  return i;
}

/**
 * Whether the AI SDK client snapshot should replace Mastra recall.
 * Client is authoritative for UI file parts (attachments must persist).
 */
export function shouldReplaceFromClient(
  stored: StoredMessage[],
  client: UiMessage[],
  forceReplace?: boolean,
): boolean {
  if (forceReplace) return true;
  if (client.length === 0) return false;
  if (stored.length === 0) return true;
  if (client.length < stored.length) return true;

  const storedIds = messageIds(stored);
  const clientIds = messageIds(client);
  if (clientIds.length === 0) return false;

  const prefix = sharedPrefixLength(storedIds, clientIds);
  if (prefix === 0 && storedIds.length > 0) return true;
  if (prefix < storedIds.length) return true;

  if (client.length > stored.length) return true;

  if (client.length === stored.length) {
    const lastClient = client.at(-1);
    const lastStored = stored.at(-1);
    if (
      lastClient?.role === 'user' &&
      lastStored?.role === 'user' &&
      lastClient.id !== lastStored?.id
    ) {
      return true;
    }
    if (lastClient?.id === lastStored?.id) return true;
  }

  return false;
}

export async function syncThreadMessagesFromClient(opts: {
  memory: Memory;
  identity: ThreadIdentity;
  clientMessages: UiMessage[];
  forceReplace?: boolean;
}): Promise<boolean> {
  return withThreadSyncLock(opts.identity.threadId, async () => {
    await ensureMastraThread(opts.memory, opts.identity);
    const recalled = await opts.memory.recall({
      threadId: opts.identity.threadId,
      resourceId: opts.identity.resourceId,
      perPage: false,
    });
    const stored = recalled.messages ?? [];

    if (!shouldReplaceFromClient(stored, opts.clientMessages, opts.forceReplace)) {
      return false;
    }

    const storedUi = mastraMessagesToAgentContext(stored);
    const merged = preserveServerTaskNotifications(opts.clientMessages, storedUi);
    await replaceThreadMessages(opts.memory, opts.identity, merged);

    // Truncated / replaced transcript is authoritative for the checklist panel.
    await setThreadTodosDb(
      opts.identity.threadId,
      resolveTodosForReplacedTranscript(merged),
    );

    return true;
  });
}

export { mastraMessagesToUi, mastraMessagesToAgentContext, mergeAgentContextMessages };
