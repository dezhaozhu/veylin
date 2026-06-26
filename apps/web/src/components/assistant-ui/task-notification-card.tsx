import type { TaskNotification } from '@veylin/shared';
import { parseLegacySubagentWriteback, parseTaskNotification } from '@veylin/shared';
import { BotIcon, CheckCircle2Icon, XCircleIcon } from 'lucide-react';
import { useState, type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

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

export function tryParseSubagentUserText(text: string): TaskNotification | { legacy: true; label: string; body: string } | null {
  const parsed = parseTaskNotification(text);
  if (parsed) return parsed;
  const legacy = parseLegacySubagentWriteback(text);
  if (legacy) return { legacy: true, label: legacy.label, body: legacy.body };
  return null;
}

export const SubagentUserMessageBody: FC<{ text: string }> = ({ text }) => {
  const parsed = tryParseSubagentUserText(text);
  if (!parsed) return <>{text}</>;
  if ('legacy' in parsed) {
    return (
      <div className={cn('border-border/40 bg-muted/20 rounded border px-2 py-1.5 text-xs')}>
        <span className="font-medium">[subagent:{parsed.label}]</span>
        {parsed.body && (
          <p className="text-muted-foreground mt-1 line-clamp-4 whitespace-pre-wrap">{parsed.body}</p>
        )}
      </div>
    );
  }
  return <TaskNotificationCard notification={parsed} />;
};
