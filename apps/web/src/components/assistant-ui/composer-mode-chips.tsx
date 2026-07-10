import { CrosshairIcon, ListTodoIcon, RefreshCwIcon, XIcon } from 'lucide-react';
import type { FC, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useGoalLoopState, usePlanMode } from '@/lib/use-composer-settings';
import { formatIntervalSeconds } from '@veylin/shared';

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
        'inline-flex h-7 max-w-[14rem] items-center gap-1 rounded-full px-2.5 text-xs font-normal',
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
  const {
    goalActive,
    pendingGoal,
    loopActive,
    pendingLoop,
    goal,
    loop,
    clearGoal,
    stopLoop,
  } = useGoalLoopState();

  const goalMode = pendingGoal || goalActive;
  const loopMode = pendingLoop || loopActive;

  if (!planMode && !goalMode && !loopMode) return null;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {planMode ? (
        <ModeChip
          label={t('slash.plan')}
          icon={<ListTodoIcon className="size-3.5" />}
          onRemove={() => setPlanMode(false)}
        />
      ) : null}
      {goalMode ? (
        <ModeChip
          label={t('slash.goal')}
          icon={<CrosshairIcon className="size-3.5" />}
          onRemove={() => {
            void clearGoal();
          }}
        />
      ) : null}
      {loopMode ? (
        <ModeChip
          label={
            loopActive && loop?.mode === 'fixed' && loop.intervalSeconds
              ? `${t('slash.loop')} ${formatIntervalSeconds(loop.intervalSeconds)}`
              : t('slash.loop')
          }
          icon={<RefreshCwIcon className="size-3.5" />}
          onRemove={() => {
            void stopLoop();
          }}
        />
      ) : null}
      {goalActive && (goal?.lastEvalReason || goal?.condition) ? (
        <span
          className="text-muted-foreground max-w-[22rem] truncate text-[11px]"
          title={[goal?.condition, goal?.lastEvalReason].filter(Boolean).join('\n')}
        >
          {goal?.lastEvalReason || goal?.condition}
        </span>
      ) : null}
    </div>
  );
};
