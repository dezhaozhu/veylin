import { makeAssistantToolUI } from '@assistant-ui/react';
import { BotIcon, LoaderIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { deriveTaskLabel } from '@veylin/shared';

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
          <span className="font-medium">{label}</span>
          <span className="text-muted-foreground">{t('status.taskRunning')}</span>
        </div>
      );
    }

    if (result?.background && result.task_id) {
      return (
        <div className="border-border/50 bg-muted/30 my-1 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs">
          <BotIcon className="text-primary size-3.5 shrink-0" />
          <span className="font-medium">{label}</span>
          <span className="text-muted-foreground">{t('status.taskQueued')}</span>
        </div>
      );
    }

    if (result?.summary) {
      return (
        <div className="border-border/50 bg-muted/30 my-1 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs">
          <BotIcon className="text-primary size-3.5 shrink-0" />
          <span className="font-medium">{label}</span>
          <span className="text-muted-foreground">{t('status.taskDone')}</span>
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
        <div className="text-muted-foreground my-1 flex items-center gap-2 text-xs">
          <span className="font-medium text-foreground">{args?.task_id?.slice(0, 8) ?? '…'}</span>
          <span>{t('status.taskQueued')}</span>
        </div>
      );
    }

    if (result?.summary) {
      return (
        <div className="border-border/40 bg-muted/20 my-1 flex items-center gap-2 rounded border px-2 py-1.5 text-xs">
          <span className="font-medium">{t('subagent.continueResult', { id: args?.task_id?.slice(0, 8) ?? '' })}</span>
          <span className="text-muted-foreground">{t('status.taskDone')}</span>
        </div>
      );
    }

    return null;
  },
});
