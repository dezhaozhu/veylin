import { CornerDownLeftIcon } from 'lucide-react';
import { useAuiState } from '@assistant-ui/store';
import { isTaskNotificationText } from '@veylin/shared';
import type { FC } from 'react';
import { splitQuotedPrefix } from '@/lib/thread-selection-ask';

/** User bubble text only — hides internal data parts (e.g. pending skill marker). */
export const UserMessageText: FC = () => {
  const text = useAuiState((s) =>
    s.message.content
      .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
      .map((part) => part.text)
      .join('\n'),
  );

  if (!text || isTaskNotificationText(text)) return null;

  const { quote, body } = splitQuotedPrefix(text);
  if (!quote) return <>{text}</>;

  return (
    <span className="flex flex-col gap-1.5">
      <span className="text-muted-foreground flex items-start gap-1.5 text-xs leading-5">
        <CornerDownLeftIcon className="mt-0.5 size-3 shrink-0" aria-hidden />
        <span className="min-w-0 whitespace-pre-wrap">“{quote}”</span>
      </span>
      {body.trim() ? <span className="whitespace-pre-wrap">{body}</span> : null}
    </span>
  );
};
