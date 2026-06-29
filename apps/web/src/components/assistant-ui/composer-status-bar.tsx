import { useAuiState } from '@assistant-ui/react';
import { ListTodoIcon, ListChecksIcon, LoaderIcon, CheckCircle2Icon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

type TodoItem = {
  id: string;
  content: string;
  status: TodoStatus;
};

interface TaskRow {
  id: string;
  status: string;
  label?: string | null;
  agentId: string;
  subagentType?: string | null;
}

const TASK_STATUS_STYLE: Record<string, string> = {
  queued: 'text-muted-foreground',
  running: 'text-primary font-medium',
  done: 'text-green-600',
  failed: 'text-destructive',
  cancelled: 'text-muted-foreground line-through',
};

const TODO_STATUS_ICON: Record<TodoStatus, string> = {
  pending: '○',
  in_progress: '◐',
  completed: '●',
  cancelled: '⊘',
};

function usePolling<T>(
  threadId: string | undefined,
  path: string,
  pick: (data: unknown) => T,
  intervalMs: number,
  fallback: T,
): T {
  const [state, setState] = useState<{ threadId: string | undefined; value: T }>(() => ({
    threadId,
    value: fallback,
  }));

  useEffect(() => {
    if (!threadId) {
      setState({ threadId, value: fallback });
      return;
    }
    let cancelled = false;
    const load = () => {
      fetch(`${path}?threadId=${encodeURIComponent(threadId)}`)
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
  }, [threadId, path, intervalMs]);

  return state.threadId === threadId ? state.value : fallback;
}

/** Per-thread expand/collapse preference for the todo checklist. */
const todoPanelOpenByThread = new Map<string, boolean>();

function readTodoPanelOpen(threadId: string | undefined): boolean {
  if (!threadId) return true;
  return todoPanelOpenByThread.get(threadId) ?? true;
}

function writeTodoPanelOpen(threadId: string | undefined, open: boolean): void {
  if (!threadId) return;
  todoPanelOpenByThread.set(threadId, open);
}

/**
 * Compact status bar above the composer: the single, always-refreshing place
 * the todo list lives (the inline todo_write card is intentionally hidden).
 * Shows progress (done/total), an all-complete state, and background tasks.
 * Click to collapse/expand the full checklist with per-item status icons.
 */
export function ComposerStatusBar() {
  const { t } = useTranslation();
  const threadId = useAuiState((s) => s.threadListItem.remoteId ?? s.threadListItem.externalId);
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const [open, setOpen] = useState(() => readTodoPanelOpen(threadId));
  const prevTotalByThreadRef = useRef(new Map<string, number>());

  useEffect(() => {
    setOpen(readTodoPanelOpen(threadId));
  }, [threadId]);

  // Refresh faster while the agent is actively running so the board updates
  // close to in-place; back off when idle to avoid needless polling.
  const todos = usePolling<TodoItem[]>(
    threadId,
    '/api/todos',
    (d) => (d as { todos?: TodoItem[] }).todos ?? [],
    isRunning ? 1500 : 6000,
    [],
  );
  const tasks = usePolling<TaskRow[]>(
    threadId,
    '/api/tasks',
    (d) => (d as { tasks?: TaskRow[] }).tasks ?? [],
    isRunning ? 2500 : 6000,
    [],
  );

  const total = todos.length;
  const doneCount = todos.filter((t) => t.status === 'completed' || t.status === 'cancelled').length;
  const openTodos = todos.filter((t) => t.status !== 'completed' && t.status !== 'cancelled');
  const allDone = total > 0 && openTodos.length === 0;
  const runningTasks = tasks.filter((t) => t.status === 'running');

  // Expand when the model adds todos in the active thread (unless user collapsed earlier).
  useEffect(() => {
    if (!threadId) return;
    const prev = prevTotalByThreadRef.current.get(threadId) ?? 0;
    if (total > prev) {
      setOpen(true);
      writeTodoPanelOpen(threadId, true);
    }
    prevTotalByThreadRef.current.set(threadId, total);
  }, [total, threadId]);

  const toggleOpen = () => {
    setOpen((current) => {
      const next = !current;
      writeTodoPanelOpen(threadId, next);
      return next;
    });
  };

  if (total === 0 && tasks.length === 0) return null;

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
              allDone && 'text-green-600',
            )}
          >
            {allDone ? (
              <CheckCircle2Icon className="size-3.5" />
            ) : (
              <ListTodoIcon className="size-3.5" />
            )}
            {allDone ? t('status.allDone') : `${doneCount}/${total}`}
          </span>
        )}
        {tasks.length > 0 && (
          <span className="flex items-center gap-1.5">
            {runningTasks.length > 0 ? (
              <LoaderIcon className="size-3.5 animate-spin" />
            ) : (
              <ListChecksIcon className="size-3.5" />
            )}
            {runningTasks.length > 0
              ? `${runningTasks.length} running`
              : `${tasks.length} tasks`}
          </span>
        )}
      </button>

      {open && (
        <div className="mt-1 flex flex-col gap-3 rounded-md border border-border/60 bg-background/60 p-2">
          {total > 0 && (
            <section>
              <div className="mb-1 flex items-center gap-1.5 font-medium">
                <ListTodoIcon className="size-3.5" />
                Todos ({doneCount}/{total} done)
              </div>
              <ul className="flex flex-col gap-0.5">
                {todos.map((t) => (
                  <li
                    key={t.id}
                    className={cn(
                      'flex items-start gap-2',
                      t.status === 'completed' && 'text-muted-foreground line-through',
                      t.status === 'cancelled' && 'text-muted-foreground line-through opacity-60',
                      t.status === 'in_progress' && 'text-foreground font-medium',
                    )}
                  >
                    <span className="mt-px w-4 shrink-0 text-center">
                      {TODO_STATUS_ICON[t.status]}
                    </span>
                    <span>{t.content}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {tasks.length > 0 && (
            <section>
              <div className="mb-1 flex items-center gap-1.5 font-medium">
                <ListChecksIcon className="size-3.5" />
                Background tasks
              </div>
              <ul className="flex flex-col gap-1">
                {tasks.map((task) => (
                  <li key={task.id} className="flex items-center gap-2">
                    {task.status === 'running' && <LoaderIcon className="size-3 animate-spin" />}
                    <span className={cn(TASK_STATUS_STYLE[task.status] ?? '')}>
                      {task.subagentType ?? task.label ?? task.agentId}
                    </span>
                    <span className="text-muted-foreground font-mono text-[10px]">
                      {task.status}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
