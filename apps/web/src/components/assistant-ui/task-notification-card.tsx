import type { TaskNotification } from '@veylin/shared';
import { formatTaskAgentKind, formatTaskDisplayName, parseTaskNotification } from '@veylin/shared';
import { BotIcon, CheckCircle2Icon, XCircleIcon } from 'lucide-react';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

function statusIcon(status: TaskNotification['status']) {
  if (status === 'completed') return <CheckCircle2Icon className="size-3.5 text-emerald-600" />;
  if (status === 'failed' || status === 'killed') return <XCircleIcon className="size-3.5 text-destructive" />;
  return <BotIcon className="text-primary size-3.5" />;
}

function parseNotificationAgentLabel(summary: string): string | null {
  const match = summary.match(/^Agent "(.+)" (?:completed|failed|killed)/);
  return match?.[1] ?? null;
}

function notificationStatusLabel(
  status: TaskNotification['status'],
  t: (key: string) => string,
): string {
  if (status === 'completed') return t('status.taskDone');
  if (status === 'failed') return t('status.taskFailed');
  if (status === 'killed') return t('status.taskCancelled');
  return t('status.taskRunning');
}

export function TaskNotificationCard({ notification }: { notification: TaskNotification }) {
  const { t } = useTranslation();
  const storedLabel = parseNotificationAgentLabel(notification.summary);
  const title = formatTaskDisplayName({
    id: notification.taskId,
    label: storedLabel,
    agentId: notification.agent_id ?? 'agent',
    subagentType: notification.subagent_type ?? null,
  });
  const kind = formatTaskAgentKind({
    id: notification.taskId,
    agentId: notification.agent_id ?? 'agent',
    subagentType: notification.subagent_type ?? null,
  });
  const statusLabel = notificationStatusLabel(notification.status, t);

  return (
    <div className="border-border/60 bg-muted/25 my-2 flex w-full max-w-xl items-center gap-2 rounded-lg border px-3 py-2 text-xs">
      {statusIcon(notification.status)}
      <span className="min-w-0 flex-1 truncate font-medium" title={title}>
        {title}
        {kind && kind !== title ? (
          <span className="text-muted-foreground ml-1.5 font-normal">{kind}</span>
        ) : null}
      </span>
      <span
        className={cn(
          'shrink-0 rounded px-1 py-0.5 text-[10px]',
          notification.status === 'completed' && 'bg-green-500/10 text-green-700 dark:text-green-400',
          (notification.status === 'failed' || notification.status === 'killed') &&
            'bg-destructive/10 text-destructive',
          notification.status === 'running' && 'bg-primary/10 text-primary',
        )}
      >
        {statusLabel}
      </span>
    </div>
  );
}

export const SubagentUserMessageBody: FC<{ text: string }> = ({ text }) => {
  const parsed = parseTaskNotification(text);
  if (!parsed) return <>{text}</>;
  return <TaskNotificationCard notification={parsed} />;
};
