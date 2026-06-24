import { XIcon } from 'lucide-react';
import type { FC } from 'react';
import { usePendingSkill } from '@/lib/use-composer-settings';

export const ComposerContextTokens: FC = () => {
  const { pendingSkill, setPendingSkill } = usePendingSkill();

  if (!pendingSkill) return null;

  return (
    <div className="aui-composer-context-tokens flex flex-wrap items-center gap-1 px-2.5 pt-1">
      <span className="text-base font-medium text-amber-700 dark:text-amber-500">
        /{pendingSkill}
      </span>
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground rounded p-0.5"
        aria-label="Remove skill"
        onClick={() => setPendingSkill(null)}
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
};
