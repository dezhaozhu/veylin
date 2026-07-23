import { GemIcon } from 'lucide-react';
import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useProjectScope } from '@/lib/use-composer-settings';
import { projectLabel } from '@/lib/project-labels';
import { cn } from '@/lib/utils';

/** Read-only pin showing the current thread's project (grouped MCP server);
 * only rendered when the tenant has at least one grouped MCP server. The
 * sidebar's Projects section is the single place to switch a thread's
 * project now — this is an indicator, not a picker. */
export const ComposerProjectChip: FC = () => {
  const { t } = useTranslation();
  const { groupedServers, currentProject } = useProjectScope();

  if (groupedServers.length === 0) return null;

  return (
    <div
      className="text-muted-foreground inline-flex h-7 max-w-[10rem] min-w-0 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-normal"
      title={t('mention.projectSwitchHint')}
    >
      <GemIcon className="size-3 shrink-0" />
      <span className={cn('truncate', !currentProject && 'italic')}>
        {currentProject ? projectLabel(currentProject) : t('mention.project')}
      </span>
    </div>
  );
};
