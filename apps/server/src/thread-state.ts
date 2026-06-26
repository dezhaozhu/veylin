import type { Memory } from '@mastra/memory';
import type { TodoItem } from '@veylin/tools';
import {
  deleteThreadStateRow,
  getThreadStateRow,
  insertThreadState,
  listThreadStatesForResource,
  listThreadStatesForTenant,
  updateThreadState,
} from '@veylin/db';
import { isDesktopAuth } from './auth';
import {
  mergeSkillNamesIntoWorkingMemory,
  replaceThreadMessages,
  type ThreadIdentity,
  type ThreadSnapshot,
  type UiMessage,
} from './message-sync';

const WM_TEMPLATE = `# Operator & Site Context
- Operator:
- Site / Line:
- Active Work Order:
- Constraints / Safety Notes:
- Open Decisions:
- Activated Skills:
`;

export interface ThreadStateRow {
  threadId: string;
  tenantId: string;
  resourceId: string;
  planMode: boolean;
  todos: TodoItem[];
  activatedSkills: Record<string, string>;
  workingMemory: string | null;
  title: string | null;
  updatedAt?: Date;
}

function toRow(r: Awaited<ReturnType<typeof getThreadStateRow>>): ThreadStateRow | null {
  if (!r) return null;
  return {
    threadId: r.threadId,
    tenantId: r.tenantId,
    resourceId: r.resourceId,
    planMode: r.planMode,
    todos: (r.todos as TodoItem[]) ?? [],
    activatedSkills: r.activatedSkills ?? {},
    workingMemory: r.workingMemory ?? null,
    title: r.title ?? null,
    updatedAt: r.updatedAt ? new Date(r.updatedAt) : undefined,
  };
}

export async function ensureThreadState(identity: ThreadIdentity): Promise<ThreadStateRow> {
  const existing = toRow(await getThreadStateRow(identity.threadId));
  if (existing) {
    if (isDesktopAuth) {
      if (existing.tenantId !== identity.tenantId) {
        await updateThreadState(identity.threadId, { tenantId: identity.tenantId });
        existing.tenantId = identity.tenantId;
      }
      return existing;
    }
    if (
      existing.tenantId !== identity.tenantId ||
      existing.resourceId !== identity.resourceId
    ) {
      throw new Error('forbidden');
    }
    return existing;
  }
  await insertThreadState({
    threadId: identity.threadId,
    tenantId: identity.tenantId,
    resourceId: identity.resourceId,
    planMode: false,
    todos: [],
    activatedSkills: {},
    workingMemory: null,
    title: null,
  });
  return {
    threadId: identity.threadId,
    tenantId: identity.tenantId,
    resourceId: identity.resourceId,
    planMode: false,
    todos: [],
    activatedSkills: {},
    workingMemory: null,
    title: null,
  };
}

export async function getThreadState(threadId: string): Promise<ThreadStateRow | null> {
  return toRow(await getThreadStateRow(threadId));
}

/** Worker / automation threads — excluded from the sidebar chat list. */
export function isSidebarChatThreadId(threadId: string): boolean {
  if (threadId.startsWith('task-')) return false;
  if (threadId.startsWith('subagent-')) return false;
  if (threadId.startsWith('cron-')) return false;
  return true;
}

/** Read-only thread resolve: returns null instead of throwing when missing or not owned. */
export async function resolveThreadForRead(
  threadId: string,
  ctx: { tenantId: string; userId: string },
): Promise<ThreadStateRow | null> {
  const row = await getThreadState(threadId);
  if (!row) return null;
  if (isDesktopAuth) {
    if (row.tenantId !== ctx.tenantId) {
      await updateThreadState(threadId, { tenantId: ctx.tenantId });
      row.tenantId = ctx.tenantId;
    }
    return row;
  }
  if (row.tenantId !== ctx.tenantId || row.resourceId !== ctx.userId) {
    return null;
  }
  return row;
}

/** Returns 403 when an existing thread belongs to another tenant/resource. */
export async function requireThreadOwnership(
  threadId: string,
  ctx: { tenantId: string; userId: string },
): Promise<ThreadStateRow> {
  const row = await resolveThreadForRead(threadId, ctx);
  if (!row) {
    throw new Error('forbidden');
  }
  return row;
}

/** Desktop startup: drop internal worker threads and empty dev leftovers. */
export async function pruneDesktopThreadClutter(
  tenantId: string,
  resourceId: string,
  memory: Memory,
): Promise<void> {
  if (!isDesktopAuth) return;

  const rows = await listThreadStatesForTenant(tenantId);
  for (const r of rows) {
    const { threadId } = r;
    if (!isSidebarChatThreadId(threadId)) {
      await deleteThreadState(threadId).catch(() => undefined);
      continue;
    }

    const recalled = await memory.recall({
      threadId,
      resourceId: r.resourceId,
      perPage: 1,
    });
    const hasMessages = (recalled.messages?.length ?? 0) > 0;

    if (!hasMessages) {
      await deleteThreadState(threadId).catch(() => undefined);
      continue;
    }

    if (r.resourceId !== resourceId) {
      await deleteThreadState(threadId).catch(() => undefined);
    }
  }
}

export async function setPlanMode(threadId: string, planMode: boolean): Promise<void> {
  await updateThreadState(threadId, { planMode });
}

export async function setTodos(
  threadId: string,
  todos: TodoItem[],
): Promise<{ oldTodos: TodoItem[]; newTodos: TodoItem[] }> {
  const row = await getThreadStateRow(threadId);
  const oldTodos = (row?.todos as TodoItem[]) ?? [];
  const newTodos = todos;
  if (row) {
    await updateThreadState(threadId, { todos: newTodos });
  }
  return { oldTodos, newTodos };
}

export async function activateSkill(
  threadId: string,
  name: string,
  content: string,
): Promise<Record<string, string>> {
  const row = await getThreadStateRow(threadId);
  const prev = (row?.activatedSkills as Record<string, string>) ?? {};
  if (prev[name]) return prev;
  const next = { ...prev, [name]: content };
  if (row) {
    await updateThreadState(threadId, { activatedSkills: next });
  }
  return next;
}

export function getSkillMemoryBlock(skills: Record<string, string>): string {
  if (Object.keys(skills).length === 0) return '';
  const lines = ['## Activated Skills'];
  for (const [name, content] of Object.entries(skills)) {
    lines.push(`### ${name}`, content);
  }
  return lines.join('\n');
}

export async function syncWorkingMemory(
  memory: Memory,
  identity: ThreadIdentity,
  activatedSkills: Record<string, string>,
  storedWorkingMemory: string | null,
): Promise<void> {
  const current = storedWorkingMemory ?? (await memory.getWorkingMemory({
    threadId: identity.threadId,
    resourceId: identity.resourceId,
  }));
  const merged = mergeSkillNamesIntoWorkingMemory(
    current,
    WM_TEMPLATE,
    Object.keys(activatedSkills),
  );
  await memory.updateWorkingMemory({
    threadId: identity.threadId,
    resourceId: identity.resourceId,
    workingMemory: merged,
  });
  await updateThreadState(identity.threadId, { workingMemory: merged });
}

export async function captureThreadSnapshot(
  memory: Memory,
  identity: ThreadIdentity,
  uiMessages: UiMessage[],
): Promise<ThreadSnapshot> {
  const state = (await getThreadState(identity.threadId)) ?? (await ensureThreadState(identity));
  let workingMemory = state.workingMemory;
  if (!workingMemory) {
    workingMemory = await memory.getWorkingMemory({
      threadId: identity.threadId,
      resourceId: identity.resourceId,
    });
  }
  return {
    messages: uiMessages,
    todos: state.todos,
    planMode: state.planMode,
    activatedSkills: state.activatedSkills,
    workingMemory,
  };
}

export async function applyThreadSnapshot(
  memory: Memory,
  identity: ThreadIdentity,
  snapshot: ThreadSnapshot,
): Promise<void> {
  await ensureThreadState(identity);
  await updateThreadState(identity.threadId, {
    planMode: snapshot.planMode,
    todos: snapshot.todos,
    activatedSkills: snapshot.activatedSkills,
    workingMemory: snapshot.workingMemory,
  });

  await replaceThreadMessages(memory, identity, snapshot.messages);

  if (snapshot.workingMemory != null) {
    await memory.updateWorkingMemory({
      threadId: identity.threadId,
      resourceId: identity.resourceId,
      workingMemory: snapshot.workingMemory,
    });
  } else {
    await syncWorkingMemory(memory, identity, snapshot.activatedSkills, null);
  }
}

export function todosFromMessageHistory(messages: UiMessage[]): TodoItem[] | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'assistant' || !m.parts) continue;
    for (const part of m.parts) {
      const p = part as {
        type?: string;
        toolName?: string;
        input?: { todos?: TodoItem[] };
        output?: { newTodos?: TodoItem[] };
      };
      if (p.type?.includes('todo_write') || p.toolName === 'todo_write') {
        const todos = p.output?.newTodos ?? p.input?.todos;
        if (todos && todos.length >= 0) return todos;
      }
    }
  }
  return null;
}

export async function restoreTodosFromHistoryIfEmpty(
  threadId: string,
  messages: UiMessage[],
): Promise<void> {
  const state = await getThreadState(threadId);
  if (state && state.todos.length > 0) return;
  const fromHistory = todosFromMessageHistory(messages);
  if (fromHistory) await setTodos(threadId, fromHistory);
}

export async function setThreadTitle(threadId: string, title: string): Promise<void> {
  await updateThreadState(threadId, { title: title.trim() || null });
}

export async function touchThreadActivity(threadId: string): Promise<void> {
  await updateThreadState(threadId, {});
}

export type ThreadListEntry = {
  remoteId: string;
  title?: string;
  lastMessageAt?: Date;
  status: 'regular' | 'archived';
};

export async function listThreadsForResource(
  tenantId: string,
  resourceId: string,
  memory?: Memory,
): Promise<ThreadListEntry[]> {
  const rows = (await listThreadStatesForResource(tenantId, resourceId)).filter((row) =>
    isSidebarChatThreadId(row.threadId),
  );

  if (!memory) {
    return rows.map((row) => ({
      remoteId: row.threadId,
      title: row.title ?? undefined,
      lastMessageAt: row.updatedAt ? new Date(row.updatedAt) : undefined,
      status: 'regular' as const,
    }));
  }

  const entries: ThreadListEntry[] = [];
  for (const row of rows) {
    const recalled = await memory.recall({
      threadId: row.threadId,
      resourceId: row.resourceId,
      perPage: 1,
    });
    if ((recalled.messages?.length ?? 0) === 0) {
      await deleteThreadState(row.threadId).catch(() => undefined);
      continue;
    }
    entries.push({
      remoteId: row.threadId,
      title: row.title ?? undefined,
      lastMessageAt: row.updatedAt ? new Date(row.updatedAt) : undefined,
      status: 'regular' as const,
    });
  }
  return entries;
}

export async function deleteThreadState(threadId: string): Promise<void> {
  await deleteThreadStateRow(threadId);
}

export { type ThreadSnapshot, type UiMessage, type ThreadIdentity };
