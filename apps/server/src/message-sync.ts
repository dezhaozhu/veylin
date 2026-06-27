import type { Memory } from '@mastra/memory';
import { filterPersistableUiMessageParts, coerceSanitizableUiParts } from '@veylin/shared';
import type { TodoItem } from '@veylin/tools';

export type UiMessage = {
  id?: string;
  role: string;
  content?: string;
  parts?: unknown[];
};

export interface ThreadSnapshot {
  messages: UiMessage[];
  todos: TodoItem[];
  planMode: boolean;
  activatedSkills: Record<string, string>;
  workingMemory: string | null;
}

export interface ThreadIdentity {
  threadId: string;
  tenantId: string;
  resourceId: string;
}

/** Mastra LibSQL requires a thread row before recall when semantic recall is off. */
export async function ensureMastraThread(
  memory: Memory,
  identity: ThreadIdentity,
): Promise<void> {
  if (!memory.getThreadById || !memory.createThread) return;
  const thread = await memory.getThreadById({ threadId: identity.threadId });
  if (!thread) {
    await memory.createThread({
      threadId: identity.threadId,
      resourceId: identity.resourceId,
    });
  }
}

function partText(parts: unknown[] | undefined): string {
  if (!parts) return '';
  return parts
    .filter((p): p is { type: string; text?: string } => typeof p === 'object' && p != null && (p as { type?: string }).type === 'text')
    .map((p) => p.text ?? '')
    .join('');
}

/** Convert AI SDK UI messages into Mastra DB messages for persistence. */
export function uiMessagesToMastra(
  messages: UiMessage[],
  identity: ThreadIdentity,
): Array<{
  id: string;
  role: string;
  createdAt: Date;
  threadId: string;
  resourceId: string;
  content: { format: 2; parts: unknown[] };
}> {
  const now = Date.now();
  return messages.map((m, i) => {
    const rawParts =
      m.parts && m.parts.length > 0
        ? m.parts
        : m.content
          ? [{ type: 'text', text: m.content }]
          : [{ type: 'text', text: '' }];
    const parts = filterPersistableUiMessageParts(coerceSanitizableUiParts(rawParts));
    return {
      id: m.id ?? crypto.randomUUID(),
      role: m.role,
      createdAt: new Date(now + i),
      threadId: identity.threadId,
      resourceId: identity.resourceId,
      content: { format: 2, parts },
    };
  });
}

/** Best-effort UI message reconstruction from Mastra recall. */
export function mastraMessagesToUi(
  messages: Array<{ id?: string; role?: string; content?: { parts?: unknown[] } }>,
): UiMessage[] {
  const out: UiMessage[] = [];
  for (const m of messages) {
    const parts = filterPersistableUiMessageParts(coerceSanitizableUiParts(m.content?.parts ?? []));
    if (parts.length === 0) continue;
    out.push({
      id: m.id,
      role: m.role ?? 'assistant',
      parts,
      content: partText(parts),
    });
  }
  return out;
}

/** Replace all messages in a Mastra thread with the given UI snapshot. */
export async function replaceThreadMessages(
  memory: Memory,
  identity: ThreadIdentity,
  messages: UiMessage[],
): Promise<void> {
  await ensureMastraThread(memory, identity);
  const recalled = await memory.recall({ threadId: identity.threadId, perPage: false });
  const existing = recalled.messages ?? [];
  if (existing.length > 0) {
    await memory.deleteMessages(existing.map((m) => m.id).filter(Boolean) as string[]);
  }
  const mastraMessages = uiMessagesToMastra(messages, identity);
  if (mastraMessages.length > 0) {
    await memory.saveMessages({ messages: mastraMessages as never });
  }
}

/** Merge activated skill names into resource-scoped working memory markdown. */
export function mergeSkillNamesIntoWorkingMemory(
  current: string | null,
  template: string,
  skillNames: string[],
): string {
  const base = (current ?? template).trim();
  const namesLine = skillNames.length > 0 ? skillNames.join(', ') : '';
  const block = `- Activated Skills: ${namesLine}`;
  if (/^- Activated Skills:/m.test(base)) {
    return base.replace(/^- Activated Skills:.*$/m, block);
  }
  return `${base}\n${block}`;
}
