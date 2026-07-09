import type { UIMessage } from 'ai';
import {
  isTaskNotificationText,
  parseTaskNotification,
} from '@veylin/shared';

export type BackgroundTaskRow = {
  id: string;
  status: string;
  label?: string | null;
  agentId?: string;
  subagentType?: string | null;
  prompt?: string | null;
  result?: string | null;
  durationMs?: number | null;
  totalTokens?: number | null;
  toolUseCount?: number | null;
  lastToolName?: string | null;
  lastToolArgs?: string | null;
  currentActivity?: string | null;
};

export function isTerminalTaskStatus(status: string): boolean {
  return status === 'done' || status === 'failed' || status === 'cancelled';
}

export function hasActiveBackgroundTasks(tasks: BackgroundTaskRow[]): boolean {
  return tasks.some((t) => t.status === 'queued' || t.status === 'running');
}

function userMessageText(message: UIMessage): string {
  return (
    message.parts
      ?.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('\n') ?? ''
  );
}

/**
 * @deprecated Worker results are persisted on the server (`writeTaskNotificationToParent`).
 * Synthesis must not re-inject full results on the client — that duplicates model context.
 * Kept for tests; production synthesis uses `sendMessage` + server merge only.
 */
export function appendTaskNotificationMessagesForSynthesis(
  messages: UIMessage[],
  _batch: BackgroundTaskRow[],
): UIMessage[] {
  return messages;
}

/** Remove synthesis-only task-notification user turns from the client transcript. */
export function stripTaskNotificationUserMessages(messages: UIMessage[]): UIMessage[] {
  return messages.filter((message) => {
    if (message.role !== 'user') return true;
    return !isTaskNotificationText(userMessageText(message));
  });
}

function messagesSinceLastUser(messages: UIMessage[]): UIMessage[] {
  const lastUserIdx = messages.findLastIndex((m) => m.role === 'user');
  return lastUserIdx >= 0 ? messages.slice(lastUserIdx + 1) : messages;
}

type TaskToolPayload = {
  background?: boolean;
  task_id?: string | null;
  description?: string | null;
  subagent_type?: string | null;
  agent_id?: string | null;
  summary?: string | null;
};

function readTaskToolPayloadFromPart(part: unknown): {
  toolCallId?: string;
  input?: {
    description?: string;
    subagent_type?: string;
    agent_id?: string;
  };
  payload?: TaskToolPayload;
} | null {
  if (!part || typeof part !== 'object') return null;
  const p = part as {
    type?: string;
    toolName?: string;
    toolCallId?: string;
    args?: {
      description?: string;
      subagent_type?: string;
      agent_id?: string;
    };
    input?: {
      description?: string;
      subagent_type?: string;
      agent_id?: string;
    };
    result?: TaskToolPayload;
    output?: TaskToolPayload;
  };

  if (p.type === 'tool-task') {
    return {
      toolCallId: p.toolCallId,
      input: p.input,
      payload: p.output ?? p.result,
    };
  }

  if (p.type === 'tool-call' && p.toolName === 'task') {
    return {
      toolCallId: p.toolCallId,
      input: p.args,
      payload: p.result ?? p.output,
    };
  }

  return null;
}

function taskDispatchRowFromPart(part: unknown, fallbackId: string): BackgroundTaskRow | null {
  const parsed = readTaskToolPayloadFromPart(part);
  if (!parsed) return null;

  const label =
    parsed.payload?.description ??
    parsed.input?.description ??
    null;
  const subagentType =
    parsed.payload?.subagent_type ?? parsed.input?.subagent_type ?? null;
  const agentId = parsed.payload?.agent_id ?? parsed.input?.agent_id ?? 'subagent';

  if (parsed.payload?.background === true && parsed.payload.task_id) {
    return {
      id: parsed.payload.task_id,
      status: 'queued',
      label,
      agentId,
      subagentType,
    };
  }

  if (typeof parsed.payload?.summary === 'string' && parsed.payload.summary.trim()) {
    return {
      id: parsed.toolCallId ?? fallbackId,
      status: 'done',
      label,
      agentId,
      subagentType,
      result: parsed.payload.summary,
    };
  }

  if (parsed.payload) {
    return null;
  }

  return {
    id: parsed.toolCallId ?? fallbackId,
    status: 'running',
    label,
    agentId,
    subagentType,
  };
}

function backgroundTaskPayloadFromPart(part: unknown): {
  taskId: string;
  description?: string | null;
  subagentType?: string | null;
  agentId?: string | null;
} | null {
  const row = taskDispatchRowFromPart(part, '');
  if (!row || row.status !== 'queued') return null;
  return {
    taskId: row.id,
    description: row.label ?? null,
    subagentType: row.subagentType ?? null,
    agentId: row.agentId ?? null,
  };
}

function backgroundTaskIdFromPart(part: unknown): string | null {
  return backgroundTaskPayloadFromPart(part)?.taskId ?? null;
}

/** Background worker ids dispatched in the current coordinator turn (since last user message). */
export function collectCoordinatorDispatchTaskIds(messages: UIMessage[]): string[] {
  const ids: string[] = [];
  for (const msg of messagesSinceLastUser(messages)) {
    if (msg.role !== 'assistant') continue;
    for (const part of msg.parts ?? []) {
      const taskId = backgroundTaskIdFromPart(part);
      if (taskId) ids.push(taskId);
    }
  }
  return ids;
}

/** @deprecated Use collectCoordinatorDispatchTaskIds */
export function collectLatestBackgroundTaskIds(messages: UIMessage[]): string[] {
  return collectCoordinatorDispatchTaskIds(messages);
}

export function coordinatorTurnHasBackgroundDispatch(messages: UIMessage[]): boolean {
  return messagesSinceLastUser(messages).some((msg) => assistantDispatchedBackgroundWorkers(msg));
}

/**
 * True while the coordinator is still on the dispatch turn — no synthesis assistant yet.
 * Task-notification user messages after dispatch still count as awaiting follow-up.
 */
export function coordinatorDispatchAwaitingFollowUp(messages: UIMessage[]): boolean {
  const dispatchIdx = messages.findLastIndex(
    (m) => m.role === 'assistant' && assistantDispatchedBackgroundWorkers(m),
  );
  if (dispatchIdx < 0) return false;
  if (messages.length - 1 <= dispatchIdx) return true;

  const tail = messages.slice(dispatchIdx + 1);
  if (tail.some((m) => m.role === 'assistant')) return false;
  return (
    tail.length > 0 &&
    tail.every((m) => m.role === 'user' && isTaskNotificationText(userMessageText(m)))
  );
}

/**
 * Claude Code shows the current dispatch batch only — not every historical worker.
 * Prefer task_ids from the latest coordinator `task` tool turn; fall back to active tasks.
 */
export function filterTasksToCurrentBatch(
  messages: UIMessage[],
  tasks: BackgroundTaskRow[],
  opts?: { pinnedTaskIds?: string[] },
): BackgroundTaskRow[] {
  const batchIds = collectCoordinatorDispatchTaskIds(messages);
  const idSource = batchIds.length > 0 ? batchIds : (opts?.pinnedTaskIds ?? []);
  if (idSource.length > 0) {
    const idSet = new Set(idSource);
    return tasks.filter((t) => idSet.has(t.id));
  }
  const active = tasks.filter((t) => t.status === 'queued' || t.status === 'running');
  if (active.length > 0) return active;
  return [];
}

/**
 * Panel display: current batch when known; fall back to active thread tasks during dispatch races.
 */
export function resolvePanelBackgroundTasks(
  messages: UIMessage[],
  tasks: BackgroundTaskRow[],
  opts?: { pinnedTaskIds?: string[] },
): BackgroundTaskRow[] {
  const batchIds = collectCoordinatorDispatchTaskIds(messages);
  const idSource = batchIds.length > 0 ? batchIds : (opts?.pinnedTaskIds ?? []);
  if (idSource.length > 0) {
    const idSet = new Set(idSource);
    const matched = tasks.filter((t) => idSet.has(t.id));
    if (matched.length > 0) return matched;
    const active = tasks.filter((t) => t.status === 'queued' || t.status === 'running');
    if (active.length > 0) return active;
    return matched;
  }
  return filterTasksToCurrentBatch(messages, tasks);
}

type ThreadMessageWithTools = {
  role?: string;
  content?: readonly unknown[];
};

/** All subagent `task` dispatches in the current turn (background + inline). */
export function collectSubagentTasksFromThreadMessages(
  messages: readonly ThreadMessageWithTools[],
): BackgroundTaskRow[] {
  const lastUserIdx = messages.findLastIndex((m) => m.role === 'user');
  const slice = lastUserIdx >= 0 ? messages.slice(lastUserIdx + 1) : messages;
  const rows: BackgroundTaskRow[] = [];
  let index = 0;
  for (const msg of slice) {
    if (msg.role !== 'assistant') continue;
    for (const part of msg.content ?? []) {
      const row = taskDispatchRowFromPart(part, `task-call-${index}`);
      index += 1;
      if (!row) continue;
      rows.push(row);
    }
  }
  return rows;
}

/** @deprecated Use collectSubagentTasksFromThreadMessages */
export function collectOptimisticBackgroundTasksFromThreadMessages(
  messages: readonly ThreadMessageWithTools[],
): BackgroundTaskRow[] {
  return collectSubagentTasksFromThreadMessages(messages).filter(
    (row) => !row.id.startsWith('task-call-'),
  );
}

/** Optimistic rows from coordinator `task` tool outputs in UI messages. */
export function collectOptimisticBackgroundTasksFromMessages(
  messages: UIMessage[],
): BackgroundTaskRow[] {
  const rows: BackgroundTaskRow[] = [];
  let index = 0;
  for (const msg of messagesSinceLastUser(messages)) {
    if (msg.role !== 'assistant') continue;
    for (const part of msg.parts ?? []) {
      const row = taskDispatchRowFromPart(part, `task-call-${index}`);
      index += 1;
      if (!row || row.id.startsWith('task-call-')) continue;
      rows.push(row);
    }
  }
  return rows;
}

/**
 * Claude Code panel: fixed dispatch batch with API status overlaid on optimistic placeholders.
 */
export function mergePanelBackgroundTasks(
  messages: UIMessage[],
  tasks: BackgroundTaskRow[],
  opts?: { pinnedTaskIds?: string[] },
): BackgroundTaskRow[] {
  const fromApi = resolvePanelBackgroundTasks(messages, tasks, opts);
  const optimistic = collectOptimisticBackgroundTasksFromMessages(messages);
  const batchIds = collectCoordinatorDispatchTaskIds(messages);
  const idSource =
    batchIds.length > 0
      ? batchIds
      : (opts?.pinnedTaskIds?.length ? opts.pinnedTaskIds : optimistic.map((t) => t.id));

  if (idSource.length === 0) {
    return fromApi.length > 0 ? fromApi : optimistic;
  }

  const byId = new Map<string, BackgroundTaskRow>();
  for (const row of optimistic) byId.set(row.id, row);
  for (const row of fromApi) {
    const prev = byId.get(row.id);
    byId.set(row.id, prev ? { ...prev, ...row } : row);
  }

  return idSource
    .map((id) => byId.get(id))
    .filter((row): row is BackgroundTaskRow => row != null);
}

export function mergePanelBackgroundTasksFromThread(
  threadMessages: readonly ThreadMessageWithTools[],
  tasks: BackgroundTaskRow[],
  opts?: { pinnedTaskIds?: string[] },
): BackgroundTaskRow[] {
  const optimistic = collectSubagentTasksFromThreadMessages(threadMessages);
  const optimisticIds = optimistic.map((t) => t.id);
  const idSource =
    optimisticIds.length > 0
      ? optimisticIds
      : (opts?.pinnedTaskIds ?? []);

  if (idSource.length === 0) {
    return tasks.filter((t) => t.status === 'queued' || t.status === 'running');
  }

  const byId = new Map<string, BackgroundTaskRow>();
  for (const row of optimistic) byId.set(row.id, row);
  for (const row of tasks) {
    if (!idSource.includes(row.id)) continue;
    const prev = byId.get(row.id);
    byId.set(row.id, prev ? { ...prev, ...row } : row);
  }

  return idSource
    .map((id) => byId.get(id))
    .filter((row): row is BackgroundTaskRow => row != null);
}

export function assistantDispatchedBackgroundWorkers(message: UIMessage): boolean {
  if (message.role !== 'assistant') return false;
  return (
    message.parts?.some((part) => {
      return backgroundTaskIdFromPart(part) != null;
    }) ?? false
  );
}

/**
 * Coordinator turn is not settled until: workers finish, notifications land in server
 * memory, and the parent synthesizes a follow-up (Claude Code partial turn).
 */
export function isCoordinatorTurnUnsettled(
  messages: UIMessage[],
  tasks: BackgroundTaskRow[],
  opts?: { notificationsReady?: boolean; pinnedTaskIds?: string[] },
): boolean {
  const last = messages.at(-1);
  if (last?.role !== 'assistant') return false;

  const batch = filterTasksToCurrentBatch(messages, tasks, opts);

  if (batch.length > 0) {
    if (hasActiveBackgroundTasks(batch)) return true;
    const allTerminal = batch.every((t) => isTerminalTaskStatus(t.status));
    if (allTerminal && opts?.notificationsReady !== true) return true;
    if (shouldSynthesizeBackgroundTaskResults(messages, batch, opts)) return true;
    return false;
  }

  return coordinatorDispatchAwaitingFollowUp(messages);
}

export type CoordinatorPartialTurnOpts = {
  notificationsReady?: boolean;
  pinnedTaskIds?: string[];
  chatStatus?: string;
  continuationPending?: boolean;
  historyLoading?: boolean;
};

/**
 * Claude Code partial turn: the coordinator dispatch message is not "complete"
 * until workers finish, notifications land, and synthesis streams a follow-up.
 * Used for isRunning + sentAt stamping — not the same as unsettled on cold restore.
 */
export function isCoordinatorPartialTurn(
  messages: UIMessage[],
  tasks: BackgroundTaskRow[],
  opts?: CoordinatorPartialTurnOpts,
): boolean {
  if (opts?.historyLoading) return false;
  if (!isCoordinatorTurnUnsettled(messages, tasks, opts)) return false;

  const batch = filterTasksToCurrentBatch(messages, tasks, opts);
  if (hasActiveBackgroundTasks(batch)) return true;
  if (opts?.chatStatus === 'streaming' || opts?.chatStatus === 'submitted') {
    return true;
  }
  if (opts?.continuationPending) return true;
  if (shouldSynthesizeBackgroundTaskResults(messages, batch, opts)) return true;
  return coordinatorDispatchAwaitingFollowUp(messages);
}

/**
 * State-driven synthesis gate (Claude Code): batch terminal + notifications in model context
 * + parent still on the dispatch assistant turn.
 */
export function shouldSynthesizeBackgroundTaskResults(
  messages: UIMessage[],
  batch: BackgroundTaskRow[],
  opts?: { notificationsReady?: boolean; pinnedTaskIds?: string[] },
): boolean {
  if (batch.length === 0) return false;
  if (hasActiveBackgroundTasks(batch)) return false;
  if (opts?.notificationsReady !== true) return false;

  const last = messages.at(-1);
  if (last?.role === 'user') {
    const dispatchIdx = messages.findLastIndex(
      (m) => m.role === 'assistant' && assistantDispatchedBackgroundWorkers(m),
    );
    if (dispatchIdx < 0) return false;
    const tail = messages.slice(dispatchIdx + 1);
    if (
      tail.length > 0 &&
      tail.every((m) => m.role === 'user' && isTaskNotificationText(userMessageText(m)))
    ) {
      return true;
    }
    return false;
  }
  if (last?.role !== 'assistant') return false;

  const dispatchIdx = messages.findLastIndex(
    (m) => m.role === 'assistant' && assistantDispatchedBackgroundWorkers(m),
  );
  if (dispatchIdx >= 0) {
    // A follow-up assistant after dispatch means synthesis already ran (partial turn settled).
    if (messages.length - 1 > dispatchIdx) return false;
    return true;
  }

  // Tool parts may be trimmed from the transcript; pinned ids still gate synthesis.
  return Boolean(opts?.pinnedTaskIds?.length);
}

/** Dedupe key for auto-synthesis after a background batch completes. */
export function backgroundTaskBatchFingerprint(tasks: BackgroundTaskRow[]): string | null {
  const terminal = tasks.filter((t) => isTerminalTaskStatus(t.status));
  if (terminal.length === 0) return null;
  return `bg-batch|${terminal
    .map((t) => `${t.id}:${t.status}`)
    .sort()
    .join(',')}`;
}
