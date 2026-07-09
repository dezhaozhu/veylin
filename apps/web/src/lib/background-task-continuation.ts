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

/** Mark in-flight tasks cancelled so the status bar stops spinning immediately on Stop. */
export function markActiveBackgroundTasksCancelled(
  tasks: BackgroundTaskRow[],
): BackgroundTaskRow[] {
  let changed = false;
  const next = tasks.map((task) => {
    if (task.status !== 'queued' && task.status !== 'running') return task;
    changed = true;
    return { ...task, status: 'cancelled' };
  });
  return changed ? next : tasks;
}

/**
 * Build a cancelled snapshot for Stop: overlay store rows + optimistic dispatch
 * rows from the transcript so the status bar does not fall back to "running".
 * Includes temporary `task-call-*` ids so empty-filter races cannot wipe the panel.
 */
export function buildInterruptedBackgroundTaskRows(
  existingTasks: BackgroundTaskRow[],
  optimisticRows: BackgroundTaskRow[],
  extraIds: string[] = [],
): BackgroundTaskRow[] {
  const byId = new Map<string, BackgroundTaskRow>();
  for (const row of existingTasks) byId.set(row.id, row);
  for (const row of optimisticRows) {
    const prev = byId.get(row.id);
    byId.set(row.id, prev ? { ...row, ...prev } : row);
  }
  for (const id of extraIds) {
    if (!id || byId.has(id)) continue;
    byId.set(id, { id, status: 'running', agentId: 'subagent' });
  }
  return markActiveBackgroundTasksCancelled(Array.from(byId.values()));
}

/** Force matching in-flight rows to cancelled for Stop UI. Does not invent new rows. */
export function applyInterruptedTaskIds(
  tasks: BackgroundTaskRow[],
  interruptedTaskIds: readonly string[],
): BackgroundTaskRow[] {
  if (interruptedTaskIds.length === 0) return tasks;
  const interrupted = new Set(interruptedTaskIds);
  let changed = false;
  const next = tasks.map((task) => {
    if (!interrupted.has(task.id)) return task;
    if (task.status === 'cancelled') return task;
    if (isTerminalTaskStatus(task.status) && task.status !== 'cancelled') return task;
    changed = true;
    return { ...task, status: 'cancelled' };
  });
  return changed ? next : tasks;
}

/** Prefer terminal API/store status over optimistic queued/running placeholders. */
export function overlayBackgroundTaskStatus(
  optimistic: BackgroundTaskRow,
  overlay: BackgroundTaskRow,
): BackgroundTaskRow {
  const merged = { ...optimistic, ...overlay };
  if (
    isTerminalTaskStatus(overlay.status) &&
    (optimistic.status === 'queued' || optimistic.status === 'running')
  ) {
    return { ...merged, status: overlay.status };
  }
  return merged;
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
      if (!row) continue;
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
    byId.set(row.id, prev ? overlayBackgroundTaskStatus(prev, row) : row);
  }

  return idSource
    .map((id) => byId.get(id))
    .filter((row): row is BackgroundTaskRow => row != null);
}

export function mergePanelBackgroundTasksFromThread(
  threadMessages: readonly ThreadMessageWithTools[],
  tasks: BackgroundTaskRow[],
  opts?: { pinnedTaskIds?: string[]; interruptedTaskIds?: readonly string[] },
): BackgroundTaskRow[] {
  const optimistic = collectSubagentTasksFromThreadMessages(threadMessages);
  const optimisticIds = optimistic.map((t) => t.id);
  const interrupted = opts?.interruptedTaskIds ?? [];
  const pinned = opts?.pinnedTaskIds ?? [];
  const keepTerminalId = (id: string) =>
    pinned.includes(id) || interrupted.includes(id);
  const idSource = Array.from(
    new Set([
      ...(optimisticIds.length > 0 ? optimisticIds : pinned),
      // Only keep terminal store rows we explicitly pin/interrupt — not every
      // historical done/failed worker from the thread.
      ...tasks
        .filter((t) => isTerminalTaskStatus(t.status) && keepTerminalId(t.id))
        .map((t) => t.id),
    ]),
  );

  if (idSource.length === 0) {
    // After Stop the store may only hold cancelled rows with no transcript ids yet.
    const terminal = tasks.filter(
      (t) => t.status === 'cancelled' || (isTerminalTaskStatus(t.status) && keepTerminalId(t.id)),
    );
    if (terminal.length > 0) return applyInterruptedTaskIds(terminal, interrupted);
    return applyInterruptedTaskIds(
      tasks.filter((t) => t.status === 'queued' || t.status === 'running'),
      interrupted,
    );
  }

  const byId = new Map<string, BackgroundTaskRow>();
  for (const row of optimistic) byId.set(row.id, row);
  for (const row of tasks) {
    const prev = byId.get(row.id);
    // Keep pinned/interrupted terminal store rows even when optimistic ids
    // (toolCallId) differ from real task_id.
    if (!idSource.includes(row.id) && !(isTerminalTaskStatus(row.status) && keepTerminalId(row.id))) {
      continue;
    }
    byId.set(row.id, prev ? overlayBackgroundTaskStatus(prev, row) : row);
  }

  const merged = idSource
    .map((id) => byId.get(id))
    .filter((row): row is BackgroundTaskRow => row != null);

  for (const row of tasks) {
    if (!(isTerminalTaskStatus(row.status) && keepTerminalId(row.id))) continue;
    if (merged.some((t) => t.id === row.id)) continue;
    merged.push(row);
  }

  return applyInterruptedTaskIds(merged, interrupted);
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
  const awaitingFollowUp = coordinatorDispatchAwaitingFollowUp(messages);

  // Synthesis (or any assistant after dispatch) already settled the partial turn.
  // Do not keep the parent "running" just because notificationsReady is still false
  // on cold restore while pinned terminal tasks remain in the snapshot.
  if (!awaitingFollowUp) {
    return hasActiveBackgroundTasks(batch);
  }

  if (batch.length > 0) {
    if (hasActiveBackgroundTasks(batch)) return true;
    const allTerminal = batch.every((t) => isTerminalTaskStatus(t.status));
    if (allTerminal && opts?.notificationsReady !== true) return true;
    if (shouldSynthesizeBackgroundTaskResults(messages, batch, opts)) return true;
    return false;
  }

  return true;
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
