import { FolderIcon } from 'lucide-react';
import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useProjectScope } from '@/lib/use-composer-settings';
import { useProjects } from '@/lib/projects-sync';
import { projectLabel } from '@/lib/project-labels';
import { cn } from '@/lib/utils';

/** Read-only pin showing the current thread's project; only rendered when
 * the tenant has at least one project. The sidebar's Projects section is the
 * single place to switch a thread's project — this is an indicator, not a
 * picker. The pin value is a project id; `projectLabel` remains only as the
 * legacy display fallback for pre-migration values (old entry-name pins in
 * stale caches). */
export const ComposerProjectChip: FC = () => {
  const { t } = useTranslation();
  const { currentProject } = useProjectScope();
  const projects = useProjects();

  if (projects.length === 0) return null;

  // Dangling pin (deleted/disabled project id): projectLabel only maps legacy
  // entry names, so an unmapped id would render as a raw UUID — fall back to
  // an honest "unavailable" label instead.
  const legacyOrFallback = (pin: string) => {
    const legacy = projectLabel(pin);
    return legacy === pin && pin.includes('-') ? t('mention.projectUnavailable') : legacy;
  };
  const label = currentProject
    ? (projects.find((p) => p.id === currentProject)?.name ?? legacyOrFallback(currentProject))
    : t('mention.project');

  return (
    <div
      className="text-muted-foreground inline-flex h-7 max-w-[10rem] min-w-0 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-normal"
      title={t('mention.projectSwitchHint')}
    >
      <FolderIcon className="size-3 shrink-0" />
      <span className={cn('truncate', !currentProject && 'italic')}>{label}</span>
    </div>
  );
};
