import { cn } from '@/lib/utils';
import { formatMessageTime } from '@/lib/message-timestamp';
import { useAuiState } from '@assistant-ui/react';
import type { FC } from 'react';

type MessageTimestampProps = {
  className?: string;
  align?: 'start' | 'end';
  inline?: boolean;
};

export const MessageTimestamp: FC<MessageTimestampProps> = ({
  className,
  align = 'end',
  inline = false,
}) => {
  const sentAt = useAuiState((s) => {
    const custom = s.message.metadata?.custom as { sentAt?: number } | undefined;
    if (typeof custom?.sentAt === 'number' && Number.isFinite(custom.sentAt)) {
      return custom.sentAt;
    }
    const createdAt = s.message.createdAt;
    return createdAt instanceof Date ? createdAt.getTime() : undefined;
  });

  if (sentAt == null) return null;

  return (
    <time
      dateTime={new Date(sentAt).toISOString()}
      className={cn(
        'text-muted-foreground/50 text-[13px] leading-none whitespace-nowrap tabular-nums',
        inline ? 'inline' : 'block',
        !inline && (align === 'end' ? 'text-end' : 'text-start'),
        className,
      )}
    >
      {formatMessageTime(sentAt)}
    </time>
  );
};
