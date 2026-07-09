import type { Memory } from '@mastra/memory';
import {
  filterAgentContextUiMessageParts,
  filterPersistableUiMessageParts,
  coerceSanitizableUiParts,
  isInternalModelContinuationText,
  isTaskNotificationText,
  parseTaskNotification,
  embedTranscriptEnvelope,
  extractTranscriptEnvelope,
  normalizeAssistantMessageParts,
} from '@veylin/shared';
import type { TodoItem } from '@veylin/tools';
import type { ThreadIdentity, ThreadSnapshot, UiMessage } from '@veylin/shared';

export type { UiMessage, ThreadSnapshot, ThreadIdentity };

function metadataFromTranscriptMeta(
  meta: { sentAt?: number; interrupted?: boolean } | undefined,
): { metadata: { custom: { sentAt?: number; interrupted?: boolean } } } | undefined {
  if (!meta) return undefined;
  const custom: { sentAt?: number; interrupted?: boolean } = {};
  if (typeof meta.sentAt === 'number') custom.sentAt = meta.sentAt;
  if (meta.interrupted) custom.interrupted = true;
  if (custom.sentAt == null && !custom.interrupted) return undefined;
  return { metadata: { custom } };
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
    const normalizedParts =
      m.role === 'assistant'
        ? normalizeAssistantMessageParts(rawParts, { mode: 'persist' })
        : rawParts;
    const enveloped = embedTranscriptEnvelope(normalizedParts, m.metadata);
    const parts = filterPersistableUiMessageParts(coerceSanitizableUiParts(enveloped));
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

function userMessageText(message: UiMessage): string {
  return (message.content ?? partText(message.parts)).trim();
}

/**
 * Mastra may append model-only continuation users during agent.stream memory writes.
 * The client UI transcript is authoritative — drop those on recall.
 * Task notifications are also model-injected (shown via Background tasks panel).
 */
export function normalizeRecalledUiMessages(
  messages: UiMessage[],
  opts?: { forDisplay?: boolean },
): UiMessage[] {
  const forDisplay = opts?.forDisplay !== false;
  const out: UiMessage[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      const text = userMessageText(message);
      if (!text) continue;
      if (isInternalModelContinuationText(text)) continue;
      if (forDisplay && isTaskNotificationText(text)) continue;

      const prev = out.at(-1);
      if (prev?.role === 'user' && userMessageText(prev) === text) continue;

      const earlierIndex = out.findIndex(
        (m) => m.role === 'user' && userMessageText(m) === text,
      );
      if (
        earlierIndex >= 0 &&
        out.slice(earlierIndex + 1).some((m) => m.role === 'assistant')
      ) {
        continue;
      }
    }

    out.push(message);
  }
  return out;
}

/** Best-effort UI message reconstruction from Mastra recall. */
export function mastraMessagesToUi(
  messages: Array<{ id?: string; role?: string; content?: { parts?: unknown[] } }>,
): UiMessage[] {
  const out: UiMessage[] = [];
  for (const m of messages) {
    const { parts: restoredParts, meta } = extractTranscriptEnvelope(
      coerceSanitizableUiParts(m.content?.parts ?? []),
    );
    const dedupedParts =
      (m.role ?? 'assistant') === 'assistant'
        ? normalizeAssistantMessageParts(restoredParts, { mode: 'persist' })
        : restoredParts;
    const parts = filterPersistableUiMessageParts(
      coerceSanitizableUiParts(dedupedParts as Parameters<typeof coerceSanitizableUiParts>[0]),
    );
    if (parts.length === 0) continue;
    out.push({
      id: m.id,
      role: m.role ?? 'assistant',
      parts,
      content: partText(parts),
      ...metadataFromTranscriptMeta(meta),
    });
  }
  return normalizeRecalledUiMessages(out, { forDisplay: true });
}

/** Recall shape for the model — keeps task-notification injections. */
export function mastraMessagesToAgentContext(
  messages: Array<{ id?: string; role?: string; content?: { parts?: unknown[] } }>,
): UiMessage[] {
  const out: UiMessage[] = [];
  for (const m of messages) {
    const { parts: restoredParts, meta } = extractTranscriptEnvelope(
      coerceSanitizableUiParts(m.content?.parts ?? []),
    );
    const dedupedParts =
      (m.role ?? 'assistant') === 'assistant'
        ? normalizeAssistantMessageParts(restoredParts, { mode: 'persist' })
        : restoredParts;
    const parts = filterAgentContextUiMessageParts(
      coerceSanitizableUiParts(dedupedParts as Parameters<typeof coerceSanitizableUiParts>[0]),
    );
    if (parts.length === 0) continue;
    out.push({
      id: m.id,
      role: m.role ?? 'assistant',
      parts,
      content: partText(parts),
      ...metadataFromTranscriptMeta(meta),
    });
  }
  return normalizeRecalledUiMessages(out, { forDisplay: false });
}

function isTaskNotificationUserMessage(message: UiMessage): boolean {
  return message.role === 'user' && isTaskNotificationText(userMessageText(message));
}

const TERMINAL_TASK_STATUSES = new Set(['done', 'failed', 'cancelled']);

export function isTerminalTaskStatus(status: string): boolean {
  return TERMINAL_TASK_STATUSES.has(status);
}

/** Count distinct task-notification injections in agent context for a worker batch. */
export function countTaskNotificationsForTaskIds(
  messages: UiMessage[],
  taskIds: string[],
): number {
  if (taskIds.length === 0) return 0;
  const wanted = new Set(taskIds);
  const seen = new Set<string>();
  for (const message of messages) {
    if (message.role !== 'user') continue;
    const text = userMessageText(message);
    if (!isTaskNotificationText(text)) continue;
    const parsed = parseTaskNotification(text);
    if (!parsed || !wanted.has(parsed.taskId) || seen.has(parsed.taskId)) continue;
    seen.add(parsed.taskId);
  }
  return seen.size;
}

/** Rows included in /api/tasks batch readiness when explicit ids are omitted. */
export function resolveSnapshotBatchRows<T extends { id: string; status: string }>(
  rows: T[],
  batchIdList: string[],
): T[] {
  if (batchIdList.length > 0) {
    return rows.filter((row) => batchIdList.includes(row.id));
  }
  return rows.filter((row) => row.status === 'queued' || row.status === 'running');
}

export function evaluateBackgroundBatchReadiness(
  batchRows: Array<{ id: string; status: string }>,
  agentContextMessages: UiMessage[],
): { notificationsReady: boolean; synthesisReady: boolean } {
  if (batchRows.length === 0) {
    return { notificationsReady: false, synthesisReady: false };
  }
  const allTerminal = batchRows.every((row) => isTerminalTaskStatus(row.status));
  const notifCount = countTaskNotificationsForTaskIds(
    agentContextMessages,
    batchRows.map((row) => row.id),
  );
  const notificationsReady = allTerminal && notifCount >= batchRows.length;
  return { notificationsReady, synthesisReady: notificationsReady };
}

/** Merge server-injected subagent notifications into the client transcript for /api/chat. */
export function mergeAgentContextMessages(
  client: UiMessage[],
  recalledForAgent: UiMessage[],
): UiMessage[] {
  const clientStripped = stripTaskNotificationsFromClient(client);

  const byTaskId = new Map<string, UiMessage>();
  for (const message of recalledForAgent) {
    if (!isTaskNotificationUserMessage(message)) continue;
    const parsed = parseTaskNotification(userMessageText(message));
    if (!parsed) continue;
    const existing = byTaskId.get(parsed.taskId);
    if (!existing) {
      byTaskId.set(parsed.taskId, message);
      continue;
    }
    const existingParsed = parseTaskNotification(userMessageText(existing));
    if (!existingParsed?.result && parsed.result) {
      byTaskId.set(parsed.taskId, message);
    }
  }

  const toInject = [...byTaskId.values()];
  if (toInject.length === 0) {
    return clientStripped.length === client.length ? client : clientStripped;
  }

  let insertAt = clientStripped.length;
  for (let i = clientStripped.length - 1; i >= 0; i -= 1) {
    if (clientStripped[i]?.role === 'assistant') {
      insertAt = i + 1;
      break;
    }
  }

  return [
    ...clientStripped.slice(0, insertAt),
    ...toInject,
    ...clientStripped.slice(insertAt),
  ];
}

/** Strip task notifications from client snapshots; preserve server copies on sync. */
export function stripTaskNotificationsFromClient(messages: UiMessage[]): UiMessage[] {
  return messages
    .map((m) => {
      if (!isTaskNotificationUserMessage(m)) return m;
      return null;
    })
    .filter((m): m is UiMessage => m != null);
}

export function preserveServerTaskNotifications(
  client: UiMessage[],
  stored: UiMessage[],
): UiMessage[] {
  const clean = stripTaskNotificationsFromClient(client);
  const preserved = stored.filter(isTaskNotificationUserMessage);
  const cleanIds = new Set(clean.map((m) => m.id).filter(Boolean));
  const merged = [...clean];
  for (const note of preserved) {
    if (note.id && cleanIds.has(note.id)) continue;
    merged.push(note);
  }
  return merged;
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
