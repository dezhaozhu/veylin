import type { Memory } from '@mastra/memory';
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
    const parts =
      m.parts && m.parts.length > 0
        ? m.parts
        : m.content
          ? [{ type: 'text', text: m.content }]
          : [{ type: 'text', text: '' }];
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
  return messages.map((m) => ({
    id: m.id,
    role: m.role ?? 'assistant',
    parts: m.content?.parts ?? [],
    content: partText(m.content?.parts),
  }));
}

/** Replace all messages in a Mastra thread with the given UI snapshot. */
export async function replaceThreadMessages(
  memory: Memory,
  identity: ThreadIdentity,
  messages: UiMessage[],
): Promise<void> {
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
