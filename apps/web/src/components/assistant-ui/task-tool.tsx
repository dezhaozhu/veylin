import { makeAssistantToolUI } from '@assistant-ui/react';
import { BotIcon, LoaderIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

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
  return (
    result?.description ??
    args?.description ??
    result?.subagent_type ??
    args?.subagent_type ??
    result?.agent_id ??
    args?.agent_id ??
    'subagent'
  );
}

export const TaskToolUI = makeAssistantToolUI<TaskToolArgs, TaskToolResult>({
  toolName: 'task',
  render: ({ args, result, status }) => {
    const { t } = useTranslation();
    const label = taskLabel(args, result);
    const running = status.type === 'running';

    if (running) {
      return (
        <div className="border-border/50 bg-muted/30 my-1 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs">
          <LoaderIcon className="text-primary size-3.5 shrink-0 animate-spin" />
          <span>
            {t('subagent.dispatching', { label })}
            {args?.run_in_background ? ` · ${t('subagent.background')}` : ''}
          </span>
        </div>
      );
    }

    if (result?.background && result.task_id) {
      return (
        <div className="border-border/50 bg-muted/30 my-1 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs">
          <BotIcon className="text-primary mt-0.5 size-3.5 shrink-0" />
          <span>
            <span className="font-medium">{label}</span>
            <span className="text-muted-foreground ml-1">
              {t('subagent.queued', { id: result.task_id.slice(0, 8) })}
            </span>
          </span>
        </div>
      );
    }

    if (result?.summary) {
      return (
        <div className="border-border/50 bg-muted/30 my-1 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs">
          <BotIcon className="text-primary mt-0.5 size-3.5 shrink-0" />
          <div className="min-w-0">
            <div className="font-medium">{label}</div>
            <p className="text-muted-foreground mt-0.5 line-clamp-4 whitespace-pre-wrap">{result.summary}</p>
          </div>
        </div>
      );
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

    if (running) {
      return (
        <div className="text-muted-foreground my-1 text-xs">
          {t('subagent.continuing', { id: args?.task_id?.slice(0, 8) ?? '…' })}
        </div>
      );
    }

    if (result?.background && result.task_id) {
      return (
        <div className="text-muted-foreground my-1 text-xs">
          {t('subagent.continueQueued', { id: result.task_id.slice(0, 8) })}
        </div>
      );
    }

    if (result?.summary) {
      return (
        <div className="border-border/40 bg-muted/20 my-1 rounded border px-2 py-1.5 text-xs">
          <div className="text-muted-foreground mb-0.5 font-medium">
            {t('subagent.continueResult', { id: args?.task_id?.slice(0, 8) ?? '' })}
          </div>
          <p className="line-clamp-4 whitespace-pre-wrap">{result.summary}</p>
        </div>
      );
    }

    return null;
  },
});
