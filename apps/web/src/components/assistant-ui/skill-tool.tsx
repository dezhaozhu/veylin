import { makeAssistantToolUI } from '@assistant-ui/react';
import { LoaderIcon, SparklesIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { skillChipDisplayName } from '@/lib/activated-skills-store';
import { cn } from '@/lib/utils';

type SkillToolArgs = {
  name: string;
};

type SkillToolResult = {
  name: string;
  content: string;
  found: boolean;
};

export const SkillToolUI = makeAssistantToolUI<SkillToolArgs, SkillToolResult>({
  toolName: 'skill',
  render: ({ args, result, status }) => {
    const { t } = useTranslation();
    const rawName = result?.name ?? args?.name ?? '';
    const label = rawName ? skillChipDisplayName(rawName) : '';
    const running = status.type === 'running';

    if (running) {
      return (
        <div className="text-muted-foreground/50 my-1 flex min-w-0 items-center gap-1.5 text-base font-normal leading-snug">
          <LoaderIcon className="size-4 shrink-0 animate-spin opacity-70" />
          <span className="min-w-0 truncate">
            {label ? t('skill.loading', { name: label }) : t('skill.loadingGeneric')}
          </span>
        </div>
      );
    }

    if (result && result.found === false) {
      return (
        <div className="text-muted-foreground/50 my-1 flex min-w-0 items-center gap-1.5 text-base font-normal leading-snug">
          <SparklesIcon className="size-4 shrink-0 opacity-70" />
          <span className="min-w-0 truncate">
            {t('skill.notFound', { name: label || rawName || '?' })}
          </span>
        </div>
      );
    }

    if (!label && !rawName) return null;

    return (
      <div
        className={cn(
          'text-muted-foreground/50 my-1 flex min-w-0 items-center gap-1.5 text-base font-normal leading-snug',
        )}
      >
        <SparklesIcon className="size-4 shrink-0 opacity-70" />
        <span className="min-w-0 truncate" title={rawName || label}>
          {t('skill.loaded', { name: label || rawName })}
        </span>
      </div>
    );
  },
});
