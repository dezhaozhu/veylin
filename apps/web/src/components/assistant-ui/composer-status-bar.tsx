import { useAuiState } from '@assistant-ui/react';
import { BotIcon, CheckCircle2Icon, ListTodoIcon, LoaderIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { formatTaskAgentKind, formatTaskDisplayName } from '@veylin/shared';
import {
  applyInterruptedTaskIds,
  collectSubagentTasksFromThreadMessages,
  mergePanelBackgroundTasksFromThread,
  type BackgroundTaskRow,
} from '@/lib/background-task-continuation';
import {
  getBackgroundTasksSnapshot,
  subscribeBackgroundTasks,
} from '@/lib/background-tasks-store';
import {
  getThreadTodosSnapshot,
  setThreadTodosSnapshot,
  subscribeThreadTodos,
  type ThreadTodoItem,
} from '@/lib/thread-todos-store';
import { isPersistableThreadId } from '@/lib/sync-thread-messages';
import { cn } from '@/lib/utils';

/** Default subagent worker concurrency (see server SUBAGENT_CONCURRENCY). */
export const SUBAGENT_PARALLEL_LIMIT = 4;

type TodoStatus = ThreadTodoItem['status'];

type TodoItem = ThreadTodoItem;

type TaskRow = BackgroundTaskRow & { agentId: string };

function asTaskRow(task: BackgroundTaskRow): TaskRow {
  return { ...task, agentId: task.agentId ?? 'subagent' };
}

const TODO_STATUS_ICON: Record<TodoStatus, string> = {
  pending: '○',
  in_progress: '◐',
  completed: '●',
  cancelled: '⊘',
};

const TASK_STATUS_ICON: Record<string, string> = {
  queued: '○',
  running: '◐',
  done: '●',
  failed: '⊘',
  cancelled: '⊘',
};

function hasDistinctTaskLabel(task: TaskRow): boolean {
  const label = task.label?.trim();
  const preset = task.subagentType?.trim();
  return Boolean(label && (!preset || (label !== preset && label !== 'fork')));
}

function usePolling<T>(
  threadId: string | undefined,
  path: string,
  pick: (data: unknown) => T,
  intervalMs: number,
  fallback: T,
  enabled = true,
  extraQuery?: Record<string, string>,
): T {
  const [state, setState] = useState<{ threadId: string | undefined; value: T }>(() => ({
    threadId,
    value: fallback,
  }));

  const extraQueryKey = extraQuery ? JSON.stringify(extraQuery) : '';

  useEffect(() => {
    if (!threadId || !enabled) {
      setState({ threadId, value: fallback });
      return;
    }
    let cancelled = false;
    const load = () => {
      const query = new URLSearchParams({ threadId, ...(extraQuery ?? {}) });
      fetch(`${path}?${query.toString()}`, { credentials: 'include' })
        .then((r) => r.json())
        .then((d: unknown) => {
          if (!cancelled) setState({ threadId, value: pick(d) });
        })
        .catch(() => undefined);
    };
    load();
    const t = window.setInterval(load, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, path, intervalMs, enabled, extraQueryKey]);

  return state.threadId === threadId ? state.value : fallback;
}

/** Per-thread expand/collapse preference for the status panel. */
const panelOpenByThread = new Map<string, boolean>();

function readPanelOpen(threadId: string | undefined): boolean {
  if (!threadId) return true;
  return panelOpenByThread.get(threadId) ?? true;
}

function writePanelOpen(threadId: string | undefined, open: boolean): void {
  if (!threadId) return;
  panelOpenByThread.set(threadId, open);
}

function useBackgroundTasksPanel() {
  return useSyncExternalStore(subscribeBackgroundTasks, getBackgroundTasksSnapshot, getBackgroundTasksSnapshot);
}

/**
 * Claude Code–style status panel above the composer: todos + current-batch agents.
 */
export function ComposerStatusBar() {
  const { t } = useTranslation();
  const threadId = useAuiState(
    (s) => s.threadListItem.remoteId ?? s.threadListItem.externalId ?? s.threadListItem.id,
  );
  const persistableThread = isPersistableThreadId(threadId);
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const threadMessages = useAuiState((s) => s.thread.messages);
  const [open, setOpen] = useState(() => readPanelOpen(threadId));
  const prevTotalByThreadRef = useRef(new Map<string, number>());
  const prevBatchCountByThreadRef = useRef(new Map<string, number>());

  const taskSnapshot = useBackgroundTasksPanel();
  // The store is a single global; only trust it when it belongs to the active
  // thread, otherwise a just-switched session would briefly show (and pin) the
  // previous thread's agents.
  const storeMatchesThread =
    taskSnapshot.threadId != null && taskSnapshot.threadId === threadId;
  const storeBatchTasks = (storeMatchesThread ? taskSnapshot.batchTasks : []) as TaskRow[];
  const dispatchTaskIds = storeMatchesThread ? (taskSnapshot.dispatchTaskIds ?? []) : [];
  const interruptedTaskIds = storeMatchesThread
    ? (taskSnapshot.interruptedTaskIds ?? [])
    : [];
  const allStoreTasks = (storeMatchesThread ? taskSnapshot.tasks : []) as TaskRow[];

  const optimisticFromThread = useMemo(
    () => collectSubagentTasksFromThreadMessages(threadMessages),
    [threadMessages],
  );

  const batchTasks = useMemo(() => {
    const mergeOpts = {
      pinnedTaskIds:
        dispatchTaskIds.length > 0
          ? dispatchTaskIds
          : storeBatchTasks.map((row) => row.id),
      interruptedTaskIds,
    };
    if (storeBatchTasks.length > 0) {
      const fromStore = mergePanelBackgroundTasksFromThread(
        threadMessages,
        storeBatchTasks,
        mergeOpts,
      );
      if (fromStore.length > 0) return fromStore;
    }
    const merged = mergePanelBackgroundTasksFromThread(threadMessages, allStoreTasks, {
      pinnedTaskIds: dispatchTaskIds,
      interruptedTaskIds,
    });
    if (merged.length > 0) return merged;
    // After Stop, overlay interrupt onto optimistic rows — do not invent ghost rows.
    if (interruptedTaskIds.length > 0 && optimisticFromThread.length > 0) {
      return applyInterruptedTaskIds(optimisticFromThread, interruptedTaskIds);
    }
    if (optimisticFromThread.length > 0) return optimisticFromThread;
    return [];
  }, [
    threadMessages,
    allStoreTasks,
    dispatchTaskIds,
    storeBatchTasks,
    optimisticFromThread,
    interruptedTaskIds,
  ]);

  const pinnedTaskIds = useMemo(
    () =>
      dispatchTaskIds.length > 0
        ? dispatchTaskIds
        : optimisticFromThread.map((row) => row.id),
    [dispatchTaskIds, optimisticFromThread],
  );

  const hasDispatchedAgents =
    optimisticFromThread.length > 0 ||
    storeBatchTasks.length > 0 ||
    pinnedTaskIds.length > 0;
  const hasActivePanelTasks = batchTasks.some(
    (task) => task.status === 'queued' || task.status === 'running',
  );
  const needsTaskFallbackPoll =
    Boolean(threadId) &&
    hasDispatchedAgents &&
    pinnedTaskIds.length > 0 &&
    (batchTasks.length === 0 || hasActivePanelTasks);

  useEffect(() => {
    setOpen(readPanelOpen(threadId));
  }, [threadId]);

  const todosFromStore = useSyncExternalStore(
    subscribeThreadTodos,
    getThreadTodosSnapshot,
    getThreadTodosSnapshot,
  );
  const storeTodos =
    todosFromStore.threadId === threadId ? todosFromStore.todos : [];

  const polledTodos = usePolling<TodoItem[]>(
    threadId,
    '/api/todos',
    (d) => {
      const next = (d as { todos?: TodoItem[] }).todos ?? [];
      if (threadId) setThreadTodosSnapshot(threadId, next);
      return next;
    },
    isRunning ? 1500 : 6000,
    [],
    persistableThread,
  );

  const todos = storeTodos.length > 0 || todosFromStore.threadId === threadId
    ? storeTodos
    : polledTodos;

  const fallbackTasks = usePolling<TaskRow[]>(
    threadId,
    '/api/tasks',
    (d) => (d as { tasks?: TaskRow[] }).tasks ?? [],
    2000,
    [],
    persistableThread && needsTaskFallbackPoll,
    pinnedTaskIds.length > 0 ? { batchIds: pinnedTaskIds.join(',') } : undefined,
  );

  const displayTasks = useMemo(() => {
    const mergeOpts = { pinnedTaskIds, interruptedTaskIds };
    const base =
      batchTasks.length > 0
        ? batchTasks
        : mergePanelBackgroundTasksFromThread(threadMessages, allStoreTasks, mergeOpts);
    if (!needsTaskFallbackPoll || fallbackTasks.length === 0) {
      return mergePanelBackgroundTasksFromThread(threadMessages, base, mergeOpts);
    }
    return mergePanelBackgroundTasksFromThread(threadMessages, fallbackTasks, mergeOpts);
  }, [
    batchTasks,
    allStoreTasks,
    needsTaskFallbackPoll,
    fallbackTasks,
    threadMessages,
    pinnedTaskIds,
    interruptedTaskIds,
  ]);

  const total = todos.length;
  const doneCount = todos.filter((t) => t.status === 'completed' || t.status === 'cancelled').length;
  const openTodos = todos.filter((t) => t.status !== 'completed' && t.status !== 'cancelled');
  const allTodosDone = total > 0 && openTodos.length === 0;
  const runningTasks = displayTasks.filter((task) => task.status === 'running');
  const queuedTasks = displayTasks.filter((task) => task.status === 'queued');
  const terminalTasks = displayTasks.filter((task) =>
    task.status === 'done' || task.status === 'failed' || task.status === 'cancelled',
  );

  useEffect(() => {
    if (!threadId) return;
    const prev = prevTotalByThreadRef.current.get(threadId) ?? 0;
    if (total > prev) {
      setOpen(true);
      writePanelOpen(threadId, true);
    }
    prevTotalByThreadRef.current.set(threadId, total);
  }, [total, threadId]);

  useEffect(() => {
    if (!threadId) return;
    const prev = prevBatchCountByThreadRef.current.get(threadId) ?? 0;
    if (displayTasks.length > prev && displayTasks.length > 0) {
      setOpen(true);
      writePanelOpen(threadId, true);
    }
    prevBatchCountByThreadRef.current.set(threadId, displayTasks.length);
  }, [displayTasks.length, threadId]);

  const toggleOpen = () => {
    setOpen((current) => {
      const next = !current;
      writePanelOpen(threadId, next);
      return next;
    });
  };

  const taskStatusLabel = (status: string): string | null => {
    if (status === 'queued') return t('status.taskQueued');
    if (status === 'running') return t('status.taskRunning');
    if (status === 'done') return t('status.taskDone');
    if (status === 'failed') return t('status.taskFailed');
    if (status === 'cancelled') return t('status.taskInterrupted');
    return null;
  };

  if (total === 0 && displayTasks.length === 0) return null;

  return (
    <div className="text-muted-foreground w-full text-xs">
      <button
        type="button"
        className="hover:text-foreground flex w-full items-center gap-3 rounded-md px-1 py-1 transition-colors"
        onClick={toggleOpen}
        aria-expanded={open}
      >
        {total > 0 && (
          <span
            className={cn(
              'flex items-center gap-1.5',
              allTodosDone && 'text-green-600',
            )}
          >
            {allTodosDone ? (
              <CheckCircle2Icon className="size-3.5" />
            ) : (
              <ListTodoIcon className="size-3.5" />
            )}
            {allTodosDone
              ? t('status.allDone')
              : t('status.todosProgress', { done: doneCount, total })}
          </span>
        )}
        {displayTasks.length > 0 && (
          <span className="flex items-center gap-1.5">
            {runningTasks.length > 0 ? (
              <LoaderIcon className="size-3.5 animate-spin" />
            ) : (
              <BotIcon className="size-3.5" />
            )}
            {runningTasks.length > 0
              ? t('status.agentsRunning', { count: runningTasks.length })
              : queuedTasks.length > 0
                ? t('status.agentsQueued', { count: queuedTasks.length })
                : terminalTasks.length === displayTasks.length
                  ? t('status.agentsDone', { count: displayTasks.length })
                  : t('status.agentsCount', { count: displayTasks.length })}
          </span>
        )}
      </button>

      {open && (
        <div className="mt-1 flex flex-col gap-2 rounded-md border border-border/60 bg-background/60 p-2">
          {total > 0 && (
            <section>
              <div className="mb-1 flex items-center gap-1.5 font-medium text-foreground">
                <ListTodoIcon className="size-3.5" />
                {t('status.todosHeading', { done: doneCount, total })}
              </div>
              <ul className="flex flex-col gap-0.5">
                {todos.map((item) => (
                  <li
                    key={item.id}
                    className={cn(
                      'flex items-start gap-2',
                      item.status === 'completed' && 'text-muted-foreground line-through',
                      item.status === 'cancelled' && 'text-muted-foreground line-through opacity-60',
                      item.status === 'in_progress' && 'text-foreground font-medium',
                    )}
                  >
                    <span className="mt-px w-4 shrink-0 text-center">
                      {TODO_STATUS_ICON[item.status]}
                    </span>
                    <span>
                      {item.status === 'in_progress' && item.activeForm
                        ? item.activeForm
                        : item.content}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {displayTasks.length > 0 && (
            <section>
              <div className="mb-1 flex flex-col gap-0.5">
                <div className="flex items-center gap-1.5 font-medium text-foreground">
                  <BotIcon className="size-3.5" />
                  {t('status.agentsHeading', { count: displayTasks.length })}
                </div>
                {queuedTasks.length > 0 ? (
                  <p className="text-muted-foreground ps-5 text-[10px] leading-snug">
                    {t('status.agentsQueueHint', {
                      queued: queuedTasks.length,
                      max: SUBAGENT_PARALLEL_LIMIT,
                    })}
                  </p>
                ) : null}
              </div>
              <ul className="flex flex-col gap-0.5">
                {displayTasks.map((task) => {
                  const row = asTaskRow(task);
                  const title = formatTaskDisplayName(row);
                  const distinctLabel = hasDistinctTaskLabel(row);
                  const statusLabel = taskStatusLabel(task.status);
                  return (
                    <li key={task.id} className="flex min-w-0 items-center gap-2">
                      <span className="mt-px w-4 shrink-0 text-center">
                        {TASK_STATUS_ICON[task.status] ?? '○'}
                      </span>
                      <span
                        className={cn(
                          'min-w-0 flex-1 truncate',
                          task.status === 'running' && 'text-foreground font-medium',
                          task.status === 'done' && 'text-foreground',
                          task.status === 'failed' && 'text-destructive',
                          task.status === 'queued' && 'text-muted-foreground',
                        )}
                        title={title}
                      >
                        {title}
                      </span>
                      {!distinctLabel && row.subagentType ? (
                        <span className="text-muted-foreground shrink-0 text-[10px]">
                          {formatTaskAgentKind(row)}
                        </span>
                      ) : null}
                      {statusLabel ? (
                        <span
                          className={cn(
                            'shrink-0 rounded px-1 py-0.5 text-[10px]',
                            task.status === 'running' && 'bg-primary/10 text-primary',
                            task.status === 'done' && 'bg-green-500/10 text-green-700 dark:text-green-400',
                            task.status === 'failed' && 'bg-destructive/10 text-destructive',
                            task.status === 'queued' && 'bg-muted text-muted-foreground',
                            task.status === 'cancelled' && 'bg-muted text-muted-foreground',
                          )}
                        >
                          {statusLabel}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
