import { SparklesIcon } from 'lucide-react';
import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { ComposerRefChip } from '@/components/assistant-ui/composer-mention/composer-ref-chip';
import { usePendingSkill } from '@/lib/use-composer-settings';

export const ComposerContextTokens: FC = () => {
  const { t } = useTranslation();
  const { pendingSkill, setPendingSkill } = usePendingSkill();

  if (!pendingSkill) return null;

  return (
    <ComposerRefChip
      icon={<SparklesIcon className="size-5 text-amber-600 dark:text-amber-500" aria-hidden />}
      title={`/${pendingSkill}`}
      subtitle={t('mention.skillType')}
      chipAriaLabel={t('mention.skillChip', { name: pendingSkill })}
      removeAriaLabel={t('slash.removeSkill')}
      onRemove={() => setPendingSkill(null)}
    />
  );
};
