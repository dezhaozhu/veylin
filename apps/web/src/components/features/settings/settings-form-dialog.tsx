import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export function SettingsFormDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  submitLabel = 'Save',
  onSubmit,
  onCancel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  submitLabel?: string;
  onSubmit: () => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-md">
        <DialogHeader className="border-border space-y-1 border-b px-6 py-4 text-left">
          <DialogTitle className="text-base">{title}</DialogTitle>
          {description && (
            <p className="text-muted-foreground text-sm leading-relaxed">{description}</p>
          )}
        </DialogHeader>
        <div className="flex max-h-[min(70vh,32rem)] flex-col gap-4 overflow-y-auto px-6 py-4">
          {children}
        </div>
        <DialogFooter className="border-border flex-row justify-end gap-2 border-t px-6 py-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onCancel?.();
              onOpenChange(false);
            }}
          >
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={onSubmit}>
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * full-page inline editor: expands in the settings page instead of a modal.
 * Avoids Radix Dialog portal/z-index issues in Tauri / Electron webviews.
 */
export function SettingsInlineEditor({
  open,
  title,
  description,
  children,
  submitLabel = 'Save',
  onSubmit,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  submitLabel?: string;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [open]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      className="border-border bg-card mb-6 rounded-xl border shadow-sm"
      role="region"
      aria-label={title}
    >
      <div className="border-border flex items-start justify-between gap-3 border-b px-5 py-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold">{title}</h3>
          {description ? (
            <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{description}</p>
          ) : null}
        </div>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground rounded-md p-1"
          aria-label={t('common.close')}
          onClick={onCancel}
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="flex max-h-[min(70vh,32rem)] flex-col gap-4 overflow-y-auto px-5 py-4">
        {children}
      </div>
      <div className="border-border flex justify-end gap-2 border-t px-5 py-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="button" onClick={onSubmit}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

export function FormField({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </span>
      {children}
      {hint && <span className="text-muted-foreground text-xs leading-relaxed">{hint}</span>}
    </label>
  );
}

export function FormInput(props: React.ComponentProps<typeof Input>) {
  return <Input className={cn('h-10 rounded-lg', props.className)} {...props} />;
}

export function FormTextarea({
  className,
  ...props
}: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'border-input bg-background focus:ring-ring/30 min-h-28 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2',
        className,
      )}
      {...props}
    />
  );
}

export function FormSelect({
  className,
  ...props
}: React.ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'border-input bg-background h-10 w-full rounded-lg border px-3 text-sm outline-none',
        className,
      )}
      {...props}
    />
  );
}
