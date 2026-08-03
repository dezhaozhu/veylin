import { MessagePrimitive } from '@assistant-ui/react';
import { useAuiState } from '@assistant-ui/store';
import { SparklesIcon } from 'lucide-react';
import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { AttachmentUI } from '@/components/assistant-ui/attachment';
import { ComposerRefChip } from '@/components/assistant-ui/composer-mention/composer-ref-chip';
import { readPendingSkillFromMessage } from '@/lib/pending-skill-message';

export function userMessageHasDisplayChips(message: {
  role?: string;
  attachments?: readonly unknown[];
  metadata?: unknown;
  parts?: readonly unknown[];
  content?: readonly unknown[];
}): boolean {
  if (message.role !== 'user') return false;
  const hasSkill = readPendingSkillFromMessage(message) != null;
  const attachmentCount = message.attachments?.length ?? 0;
  return attachmentCount > 0 || hasSkill;
}

const UserMessageSkillChip: FC = () => {
  const { t } = useTranslation();
  const skill = useAuiState((s) =>
    s.message.role === 'user' ? readPendingSkillFromMessage(s.message) : null,
  );

  if (!skill) return null;

  return (
    <ComposerRefChip
      removable={false}
      icon={<SparklesIcon className="size-5 text-amber-600 dark:text-amber-500" aria-hidden />}
      title={`/${skill}`}
      subtitle={t('mention.skillType')}
      chipAriaLabel={t('mention.skillChip', { name: skill })}
    />
  );
};

/** Sent message: PDF/file chips and activated skill in one row (matches composer). */
export const UserMessageChipsRow: FC = () => {
  const hasChips = useAuiState((s) => userMessageHasDisplayChips(s.message));

  if (!hasChips) return null;

  return (
    <div className="aui-user-message-chips flex w-full flex-row flex-nowrap justify-end gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <MessagePrimitive.Attachments>{() => <AttachmentUI />}</MessagePrimitive.Attachments>
      <UserMessageSkillChip />
    </div>
  );
};
