'use client';

import { SparklesIcon } from 'lucide-react';
import type { FC } from 'react';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuiState } from '@assistant-ui/react';
import { ComposerRefChip } from '@/components/assistant-ui/composer-mention/composer-ref-chip';
import {
  getActivatedSkillsSnapshot,
  skillChipDisplayName,
  subscribeActivatedSkills,
} from '@/lib/activated-skills-store';

/** Read-only chips for skills the user pinned via /skill (not Skill-tool loads). */
export const ComposerActivatedSkills: FC = () => {
  const { t } = useTranslation();
  const threadId = useAuiState(
    (s) => s.threadListItem.remoteId ?? s.threadListItem.externalId,
  );
  const snapshot = useSyncExternalStore(
    subscribeActivatedSkills,
    getActivatedSkillsSnapshot,
    getActivatedSkillsSnapshot,
  );

  if (!threadId || snapshot.threadId !== threadId || snapshot.skillNames.length === 0) {
    return null;
  }

  return (
    <>
      {snapshot.skillNames.map((name) => {
        const short = skillChipDisplayName(name);
        return (
          <ComposerRefChip
            key={name}
            icon={<SparklesIcon className="size-5 text-emerald-600 dark:text-emerald-500" aria-hidden />}
            title={`/${short}`}
            subtitle={t('mention.activatedSkillType')}
            chipAriaLabel={t('mention.activatedSkillChip', { name })}
            removable={false}
          />
        );
      })}
    </>
  );
};
