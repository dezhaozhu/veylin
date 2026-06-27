import type { TaskNotification } from '@veylin/shared';
import { parseTaskNotification } from '@veylin/shared';
import { BotIcon, CheckCircle2Icon, XCircleIcon } from 'lucide-react';
import { useState, type FC } from 'react';
import { useTranslation } from 'react-i18next';

function statusIcon(status: TaskNotification['status']) {
  if (status === 'completed') return <CheckCircle2Icon className="size-3.5 text-emerald-600" />;
  if (status === 'failed' || status === 'killed') return <XCircleIcon className="size-3.5 text-destructive" />;
  return <BotIcon className="text-primary size-3.5" />;
}

export function TaskNotificationCard({ notification }: { notification: TaskNotification }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const typeLabel = notification.subagent_type ?? notification.agent_id ?? 'agent';

  return (
    <div className="border-border/60 bg-muted/25 my-2 w-full max-w-xl rounded-lg border text-xs">
      <button
        type="button"
        className="flex w-full items-start gap-2 px-3 py-2 text-left"
        onClick={() => notification.result && setOpen((v) => !v)}
      >
        {statusIcon(notification.status)}
        <div className="min-w-0 flex-1">
          <div className="font-medium">
            {typeLabel}
            <span className="text-muted-foreground ml-1.5 font-normal">{notification.summary}</span>
          </div>
          {notification.usage?.duration_ms != null && (
            <div className="text-muted-foreground mt-0.5">
              {t('subagent.duration', { ms: notification.usage.duration_ms })}
              {notification.usage.total_tokens != null &&
                ` · ${t('subagent.tokens', { count: notification.usage.total_tokens })}`}
            </div>
          )}
        </div>
        {notification.result && (
          <span className="text-muted-foreground shrink-0">{open ? '▾' : '▸'}</span>
        )}
      </button>
      {open && notification.result && (
        <div className="border-border/40 text-muted-foreground border-t px-3 py-2 whitespace-pre-wrap">
          {notification.result}
        </div>
      )}
    </div>
  );
}

export const SubagentUserMessageBody: FC<{ text: string }> = ({ text }) => {
  const parsed = parseTaskNotification(text);
  if (!parsed) return <>{text}</>;
  return <TaskNotificationCard notification={parsed} />;
};
