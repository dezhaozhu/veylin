import { XIcon } from 'lucide-react';
import type { FC, ReactNode } from 'react';

type ComposerRefChipProps = {
  icon: ReactNode;
  title: string;
  subtitle: string;
  chipAriaLabel: string;
  removeAriaLabel?: string;
  onRemove?: () => void;
  removable?: boolean;
};

export const ComposerRefChip: FC<ComposerRefChipProps> = ({
  icon,
  title,
  subtitle,
  chipAriaLabel,
  removeAriaLabel,
  onRemove,
  removable = true,
}) => {
  return (
    <div className="aui-composer-ref-chip relative w-44 shrink-0">
      <div
        className={`border-border/70 bg-background flex w-full min-w-0 items-center gap-2.5 rounded-xl border px-2.5 py-2 shadow-sm ${removable ? 'pe-8' : ''}`}
        aria-label={chipAriaLabel}
      >
        <div className="bg-muted/60 flex size-10 shrink-0 items-center justify-center rounded-lg">
          {icon}
        </div>
        <div className="min-w-0 flex-1 overflow-hidden">
          <p className="truncate text-sm leading-tight text-foreground" title={title}>
            {title}
          </p>
          <p className="text-muted-foreground mt-0.5 truncate text-xs leading-none uppercase">
            {subtitle}
          </p>
        </div>
        {removable && onRemove ? (
          <button
            type="button"
            className="absolute end-1.5 top-1.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-black text-white shadow-sm transition-opacity hover:opacity-80"
            aria-label={removeAriaLabel}
            onClick={onRemove}
          >
            <XIcon className="size-2.5 stroke-[2.5px]" />
          </button>
        ) : null}
      </div>
    </div>
  );
};
