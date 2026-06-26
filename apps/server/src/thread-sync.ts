import type { Memory } from '@mastra/memory';
import {
  mastraMessagesToUi,
  replaceThreadMessages,
  type ThreadIdentity,
  type UiMessage,
} from './message-sync';
import { setTodos as setThreadTodosDb, todosFromMessageHistory } from './thread-state';

type StoredMessage = { id?: string; role?: string };

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
  branchEdit?: boolean,
): boolean {
  if (branchEdit) return true;
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
  branchEdit?: boolean;
}): Promise<boolean> {
  const recalled = await opts.memory.recall({
    threadId: opts.identity.threadId,
    resourceId: opts.identity.resourceId,
    perPage: false,
  });
  const stored = recalled.messages ?? [];

  if (!shouldReplaceFromClient(stored, opts.clientMessages, opts.branchEdit)) {
    return false;
  }

  await replaceThreadMessages(opts.memory, opts.identity, opts.clientMessages);

  const todos = todosFromMessageHistory(opts.clientMessages);
  if (todos != null) {
    await setThreadTodosDb(opts.identity.threadId, todos);
  }

  return true;
}

export { mastraMessagesToUi };
