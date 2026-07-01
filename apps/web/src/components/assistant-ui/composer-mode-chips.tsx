import { NotebookPenIcon, XIcon } from 'lucide-react';
import type { FC, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { usePlanMode } from '@/lib/use-composer-settings';

function ModeChip({
  label,
  icon,
  onRemove,
}: {
  label: string;
  icon: ReactNode;
  onRemove: () => void;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-7 max-w-[10rem] items-center gap-1 rounded-full px-2.5 text-xs font-normal',
        'bg-amber-500/15 text-amber-800 dark:text-amber-200',
      )}
    >
      <span className="opacity-80">{icon}</span>
      <span className="truncate">{label}</span>
      <button
        type="button"
        className="hover:bg-amber-500/20 -mr-1 rounded-full p-0.5"
        aria-label={`Remove ${label}`}
        onClick={onRemove}
      >
        <XIcon className="size-3" />
      </button>
    </span>
  );
}

export const ComposerModeChips: FC = () => {
  const { t } = useTranslation();
  const { planMode, setPlanMode } = usePlanMode();

  if (!planMode) return null;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      <ModeChip
        label={t('slash.plan')}
        icon={<NotebookPenIcon className="size-3.5" />}
        onRemove={() => setPlanMode(false)}
      />
    </div>
  );
};
