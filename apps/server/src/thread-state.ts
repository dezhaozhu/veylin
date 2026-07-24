import {
  DEFAULT_GOAL_MAX_TURNS,
  DEFAULT_LOOP_MAX_AGE_DAYS,
  type ThreadGoalState,
  type ThreadLoopState,
  DEFAULT_WORKING_MEMORY_TEMPLATE,
} from '@veylin/shared';
import type { Memory } from '@mastra/memory';
import type { TodoItem } from '@veylin/tools';
import {
  deleteThreadStateRow,
  getThreadStateRow,
  insertThreadState,
  listThreadStatesForResource,
  listThreadStatesForTenant,
  listThreadStatesWithProject,
  updateThreadState,
} from '@veylin/db';
import { isDesktopAuth } from './auth';
import {
  mergeSkillNamesIntoWorkingMemory,
  replaceThreadMessages,
  mastraMessagesToUi,
  type ThreadIdentity,
  type ThreadSnapshot,
  type UiMessage,
} from './message-sync';
import {
  firstUserText,
  generateThreadTitle,
  truncateTitle,
} from './thread-title.js';
import type { ModelKey } from '@veylin/runtime';

const WM_TEMPLATE = DEFAULT_WORKING_MEMORY_TEMPLATE;

export interface ThreadStateRow {
  threadId: string;
  tenantId: string;
  resourceId: string;
  planMode: boolean;
  todos: TodoItem[];
  activatedSkills: Record<string, string>;
  pinnedSkills: string[];
  workingMemory: string | null;
  title: string | null;
  goal: ThreadGoalState | null;
  loop: ThreadLoopState | null;
  project: string | null;
  /** Move-boundary bookkeeping — see `@veylin/db`'s `ThreadStateRow` for the
   * full rationale. Set only by POST /api/project's user-directed move. */
  movedFrom: string | null;
  movedAt: string | null;
  updatedAt?: Date;
}

function asGoal(value: unknown): ThreadGoalState | null {
  if (!value || typeof value !== 'object') return null;
  return value as ThreadGoalState;
}

function asLoop(value: unknown): ThreadLoopState | null {
  if (!value || typeof value !== 'object') return null;
  return value as ThreadLoopState;
}

export function ephemeralThreadState(identity: ThreadIdentity): ThreadStateRow {
  return {
    threadId: identity.threadId,
    tenantId: identity.tenantId,
    resourceId: identity.resourceId,
    planMode: false,
    todos: [],
    activatedSkills: {},
    pinnedSkills: [],
    workingMemory: null,
    title: null,
    goal: null,
    loop: null,
    project: null,
    movedFrom: null,
    movedAt: null,
  };
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
    pinnedSkills: r.pinnedSkills ?? [],
    workingMemory: r.workingMemory ?? null,
    title: r.title ?? null,
    goal: asGoal(r.goal),
    loop: asLoop(r.loop),
    project: r.project ?? null,
    movedFrom: r.movedFrom ?? null,
    movedAt: r.movedAt ?? null,
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
    pinnedSkills: [],
    workingMemory: null,
    title: null,
    goal: null,
    loop: null,
    project: null,
    movedFrom: null,
    movedAt: null,
  });
  return {
    threadId: identity.threadId,
    tenantId: identity.tenantId,
    resourceId: identity.resourceId,
    planMode: false,
    todos: [],
    activatedSkills: {},
    pinnedSkills: [],
    workingMemory: null,
    title: null,
    goal: null,
    loop: null,
    project: null,
    movedFrom: null,
    movedAt: null,
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
  if (threadId.startsWith('wf-')) return false;
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

/** Per-thread project pin (e.g. tenant/dataset scope). `null` clears the pin. */
export async function setProject(threadId: string, project: string | null): Promise<void> {
  await updateThreadState(threadId, { project });
}

/**
 * Pure move-boundary computation for POST /api/project (audit fix #3): a
 * user-directed change AWAY from a previously non-null pin stamps
 * `movedFrom`/`movedAt` so `buildProjectPinBlock` can warn the model that
 * turns before this point in the thread belong to a different project's
 * data. No-ops (returns just `{ project }`) when there was no prior pin, or
 * the pin didn't actually change — re-pinning the same project isn't a move.
 *
 * Deliberately NOT folded into the generic `setProject` above: that helper is
 * also used by `routes/chat.ts`'s scoped-MCP auto-pin, which is inference
 * (the server deciding a thread's likely project from which MCP group is
 * connected), not a user-directed move — auto-pin churn shouldn't leave a
 * "you left project X" trail. Exported for testing at this seam (no HTTP
 * harness in this repo — mirrors `isValidProjectPin` in routes/threads.ts).
 *
 * When there's no real move (no prior pin, or re-pinning the same value),
 * `movedFrom`/`movedAt` are omitted from the patch entirely rather than set
 * to `null` — an idempotent re-pin must not erase an earlier move marker.
 */
export function computeProjectMovePatch(
  previousProject: string | null,
  nextProject: string | null,
  now: Date = new Date(),
): Pick<ThreadStateRow, 'project'> & Partial<Pick<ThreadStateRow, 'movedFrom' | 'movedAt'>> {
  if (previousProject != null && previousProject !== nextProject) {
    return { project: nextProject, movedFrom: previousProject, movedAt: now.toISOString() };
  }
  return { project: nextProject };
}

/** Sets the project pin with move-boundary bookkeeping — see
 * {@link computeProjectMovePatch}. Used by POST /api/project only. */
export async function setProjectWithMoveTracking(
  threadId: string,
  previousProject: string | null,
  nextProject: string | null,
): Promise<void> {
  const patch = computeProjectMovePatch(previousProject, nextProject);
  await updateThreadState(threadId, patch);
}

export async function setThreadGoal(
  threadId: string,
  goal: ThreadGoalState | null,
): Promise<void> {
  await updateThreadState(threadId, { goal });
}

export async function setThreadLoop(
  threadId: string,
  loop: ThreadLoopState | null,
): Promise<void> {
  await updateThreadState(threadId, { loop });
}

export function createActiveGoal(
  condition: string,
  maxTurns = DEFAULT_GOAL_MAX_TURNS,
): ThreadGoalState {
  const now = new Date().toISOString();
  return {
    condition: condition.trim(),
    status: 'active',
    turnsEvaluated: 0,
    maxTurns,
    needsContinuation: false,
    startedAt: now,
    updatedAt: now,
  };
}

export function createActiveLoop(input: {
  prompt: string;
  mode: ThreadLoopState['mode'];
  intervalSeconds?: number;
}): ThreadLoopState {
  const now = new Date();
  const createdAt = now.toISOString();
  const nextWakeAt =
    input.mode === 'fixed' && input.intervalSeconds
      ? new Date(now.getTime() + input.intervalSeconds * 1000).toISOString()
      : undefined;
  return {
    prompt: input.prompt.trim(),
    mode: input.mode,
    intervalSeconds: input.intervalSeconds,
    nextWakeAt,
    jobId: crypto.randomUUID().slice(0, 8),
    status: 'active',
    maxAgeDays: DEFAULT_LOOP_MAX_AGE_DAYS,
    createdAt,
  };
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
  if (prev[name] === content) return prev;
  const next = { ...prev, [name]: content };
  if (row) {
    await updateThreadState(threadId, { activatedSkills: next });
  }
  return next;
}

/** Mark a skill as user-pinned in the composer (slash /skill). Does not activate content. */
export async function pinSkill(threadId: string, name: string): Promise<string[]> {
  const row = await getThreadStateRow(threadId);
  const prev = row?.pinnedSkills ?? [];
  if (prev.includes(name)) return prev;
  const next = [...prev, name];
  if (row) {
    await updateThreadState(threadId, { pinnedSkills: next });
  }
  return next;
}

/**
 * Activate skill content for memory and pin it in the composer.
 * Only for user-initiated pendingSkill (slash), not Skill tool.
 */
export async function activateAndPinSkill(
  threadId: string,
  name: string,
  content: string,
): Promise<{ activatedSkills: Record<string, string>; pinnedSkills: string[] }> {
  const activatedSkills = await activateSkill(threadId, name, content);
  const pinnedSkills = await pinSkill(threadId, name);
  return { activatedSkills, pinnedSkills };
}

/**
 * Re-read activated skill bodies from disk/catalog so customize edits apply on
 * the next turn without requiring re-activation. Missing skills keep prior text.
 */
export function mergeActivatedSkillContents(
  prev: Record<string, string>,
  latestByName: Record<string, string | null | undefined>,
): { next: Record<string, string>; changed: boolean } {
  let changed = false;
  const next: Record<string, string> = { ...prev };
  for (const name of Object.keys(prev)) {
    const latest = latestByName[name];
    if (latest != null && latest !== prev[name]) {
      next[name] = latest;
      changed = true;
    }
  }
  return { next, changed };
}

export async function refreshActivatedSkills(
  threadId: string,
  resolveContent: (name: string) => Promise<string | null>,
): Promise<Record<string, string>> {
  const row = await getThreadStateRow(threadId);
  const prev = (row?.activatedSkills as Record<string, string>) ?? {};
  const names = Object.keys(prev);
  if (names.length === 0) return prev;

  const latestByName: Record<string, string | null> = {};
  await Promise.all(
    names.map(async (name) => {
      latestByName[name] = await resolveContent(name);
    }),
  );

  const { next, changed } = mergeActivatedSkillContents(prev, latestByName);
  if (changed && row) {
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
    pinnedSkills: state.pinnedSkills,
    workingMemory,
    goal: state.goal,
    loop: state.loop,
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
    pinnedSkills: snapshot.pinnedSkills ?? [],
    workingMemory: snapshot.workingMemory,
    goal: snapshot.goal ?? null,
    loop: snapshot.loop ?? null,
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
    // Walk parts backward so multiple todo_write calls in one turn yield the latest.
    for (let j = m.parts.length - 1; j >= 0; j--) {
      const p = m.parts[j] as {
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

async function deriveThreadTitleFromMemory(
  memory: Memory,
  threadId: string,
  resourceId: string,
): Promise<string | null> {
  try {
    const recalled = await memory.recall({ threadId, resourceId, perPage: false });
    const ui = mastraMessagesToUi(recalled.messages ?? []);
    const text = firstUserText(ui);
    return text ? truncateTitle(text) : null;
  } catch {
    return null;
  }
}

/** Set a sidebar title on first chat turn; backfills from memory when needed. */
export async function ensureThreadTitleIfMissing(
  threadId: string,
  requestMessages: readonly unknown[],
  options?: {
    memory?: Memory;
    resourceId?: string;
    modelKey?: ModelKey;
  },
): Promise<string | null> {
  const existing = await getThreadState(threadId);
  if (existing?.title?.trim()) return existing.title;

  let source: readonly unknown[] = requestMessages;
  if (!firstUserText(source) && options?.memory && options.resourceId) {
    try {
      const recalled = await options.memory.recall({
        threadId,
        resourceId: options.resourceId,
        perPage: false,
      });
      source = mastraMessagesToUi(recalled.messages ?? []);
    } catch {
      // ignore recall failures — fall through to request messages
    }
  }

  const prompt = firstUserText(source);
  if (!prompt) return null;

  const title = await generateThreadTitle(source, options?.modelKey ?? 'default');
  const resolved = title === 'New Chat' ? truncateTitle(prompt) : title;
  await setThreadTitle(threadId, resolved);
  return resolved;
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

  return Promise.all(
    rows.map(async (row) => {
      let title = row.title?.trim() || undefined;
      if (!title && memory) {
        const derived = await deriveThreadTitleFromMemory(memory, row.threadId, resourceId);
        if (derived) {
          title = derived;
          await setThreadTitle(row.threadId, derived);
        }
      }

      return {
        remoteId: row.threadId,
        title,
        lastMessageAt: row.updatedAt ? new Date(row.updatedAt) : undefined,
        status: 'regular' as const,
      };
    }),
  );
}

/**
 * Bulk thread→project map for a tenant (non-null pins only) — backs
 * GET /api/projects/threads (Projects sidebar grouping). Mirrors
 * listThreadsForResource: a thin db-row → shape transform over the repo call.
 */
export async function listThreadProjects(tenantId: string): Promise<Record<string, string>> {
  const rows = await listThreadStatesWithProject(tenantId);
  const map: Record<string, string> = {};
  for (const row of rows) {
    if (row.project) map[row.threadId] = row.project;
  }
  return map;
}

export async function deleteThreadState(
  threadId: string,
  memory?: Memory,
): Promise<void> {
  if (memory) {
    const recalled = await memory.recall({ threadId, perPage: false });
    const messageIds = (recalled.messages ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (messageIds.length > 0) {
      await memory.deleteMessages(messageIds);
    }
  }
  await deleteThreadStateRow(threadId);
}

export { type ThreadSnapshot, type UiMessage, type ThreadIdentity };
