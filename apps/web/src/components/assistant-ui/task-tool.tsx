import { makeAssistantToolUI } from '@assistant-ui/react';
import { BotIcon, LoaderIcon } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { deriveTaskLabel } from '@veylin/shared';
import type { BackgroundTaskRow } from '@/lib/background-task-continuation';
import {
  getBackgroundTasksSnapshot,
  subscribeBackgroundTasks,
} from '@/lib/background-tasks-store';
import { cn } from '@/lib/utils';

type TaskToolArgs = {
  description?: string;
  subagent_type?: string;
  agent_id?: string;
  prompt: string;
  run_in_background?: boolean;
};

type TaskToolResult = {
  subagent_type: string | null;
  agent_id: string | null;
  description: string | null;
  summary: string | null;
  task_id: string | null;
  background: boolean;
  notification: string | null;
};

function taskLabel(args: TaskToolArgs | undefined, result: TaskToolResult | undefined): string {
  const fork =
    result?.subagent_type === 'fork' ||
    (!result?.subagent_type && !result?.agent_id && !args?.subagent_type && !args?.agent_id);
  if (fork) {
    return result?.description ?? args?.description ?? 'fork';
  }
  return deriveTaskLabel({
    description: result?.description ?? args?.description,
    prompt: args?.prompt ?? '',
    subagentType: result?.subagent_type ?? args?.subagent_type ?? null,
    agentId: result?.agent_id ?? args?.agent_id ?? 'subagent',
    defaultLabel: result?.subagent_type ?? args?.subagent_type ?? result?.agent_id ?? args?.agent_id ?? 'subagent',
  });
}

function useTaskProgressRow(
  taskId: string | null | undefined,
  label?: string | null,
): BackgroundTaskRow | null {
  return useSyncExternalStore(
    subscribeBackgroundTasks,
    () => {
      const snap = getBackgroundTasksSnapshot();
      if (taskId) {
        return snap.tasks.find((t) => t.id === taskId) ?? null;
      }
      if (label) {
        return (
          snap.tasks.find(
            (t) =>
              (t.status === 'running' || t.status === 'queued') &&
              (t.label === label || t.label?.includes(label)),
          ) ?? null
        );
      }
      return null;
    },
    () => null,
  );
}

/** One-line detail after the title: tool name + args (not "N tools" / status). */
function progressDetail(row: BackgroundTaskRow | null): string | null {
  if (!row) return null;
  if (row.lastToolName) {
    return row.lastToolArgs
      ? `${row.lastToolName} ${row.lastToolArgs}`
      : row.lastToolName;
  }
  const activity = row.currentActivity?.trim();
  if (!activity) return null;
  // Drop legacy "tool · N tools" / initializing copy from older servers.
  if (/·\s*\d+\s*tools?/i.test(activity)) {
    return activity.replace(/\s*·\s*\d+\s*tools?/i, '').trim() || null;
  }
  if (/^(Initializing|初始化)/i.test(activity)) return null;
  return activity;
}

function TaskRow({
  label,
  detail,
  running,
}: {
  label: string;
  detail?: string | null;
  running?: boolean;
}) {
  const Icon = running ? LoaderIcon : BotIcon;
  return (
    <div className="text-muted-foreground/50 my-1 flex min-w-0 items-center gap-1.5 text-base font-normal leading-snug">
      <Icon
        className={cn(
          'size-4 shrink-0 opacity-70',
          running && 'animate-spin',
        )}
      />
      <span className="min-w-0 truncate font-normal" title={label}>
        {label}
      </span>
      {detail ? (
        <span className="min-w-0 truncate opacity-80" title={detail}>
          {detail}
        </span>
      ) : null}
    </div>
  );
}

export const TaskToolUI = makeAssistantToolUI<TaskToolArgs, TaskToolResult>({
  toolName: 'task',
  render: ({ args, result, status }) => {
    const label = taskLabel(args, result);
    const running = status.type === 'running';
    const progressRow = useTaskProgressRow(result?.task_id, label);
    const detail = progressDetail(progressRow);

    if (running) {
      return <TaskRow label={label} detail={detail} running />;
    }

    if (result?.background && result.task_id) {
      return <TaskRow label={label} detail={detail} />;
    }

    if (result?.summary) {
      return <TaskRow label={label} detail={detail} />;
    }

    if (result?.task_id || args?.description || args?.prompt) {
      return <TaskRow label={label} detail={detail} />;
    }

    return null;
  },
});

export const TaskContinueToolUI = makeAssistantToolUI<
  { task_id: string; message: string; run_in_background?: boolean },
  TaskToolResult
>({
  toolName: 'task_continue',
  render: ({ args, result, status }) => {
    const { t } = useTranslation();
    const running = status.type === 'running';
    const progressRow = useTaskProgressRow(args?.task_id ?? result?.task_id);
    const detail = progressDetail(progressRow);
    const shortId = args?.task_id?.slice(0, 8) ?? '…';

    if (running) {
      return (
        <div className="text-muted-foreground/50 my-1 flex min-w-0 items-center gap-1.5 text-base font-normal leading-snug">
          <LoaderIcon className="size-4 shrink-0 animate-spin opacity-70" />
          <span className="shrink-0 font-normal">
            {t('subagent.continuing', { id: shortId })}
          </span>
          {detail ? (
            <span className="min-w-0 truncate opacity-80" title={detail}>
              {detail}
            </span>
          ) : null}
        </div>
      );
    }

    if (result?.background && result.task_id) {
      return (
        <div className="text-muted-foreground/50 my-1 flex min-w-0 items-center gap-1.5 text-base font-normal leading-snug">
          <span className="shrink-0 font-normal">{shortId}</span>
          {detail ? (
            <span className="min-w-0 truncate opacity-80" title={detail}>
              {detail}
            </span>
          ) : null}
        </div>
      );
    }

    if (result?.summary) {
      return (
        <div className="text-muted-foreground/50 my-1 flex min-w-0 items-center gap-1.5 text-base font-normal leading-snug">
          <span className="shrink-0 font-normal">
            {t('subagent.continueResult', { id: shortId })}
          </span>
          {detail ? (
            <span className="min-w-0 truncate opacity-80" title={detail}>
              {detail}
            </span>
          ) : null}
        </div>
      );
    }

    return null;
  },
});
