import { Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export function SettingsEditButton({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className={cn('text-muted-foreground hover:text-foreground size-8 shrink-0', className)}
      aria-label={t('common.edit')}
      onClick={onClick}
      data-no-window-drag
    >
      <Pencil className="size-4" />
    </Button>
  );
}

export function SettingsDeleteButton({
  onClick,
  className,
  disabled,
}: {
  onClick: () => void;
  className?: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className={cn('text-muted-foreground hover:text-destructive size-8 shrink-0', className)}
      aria-label={t('common.delete')}
      onClick={onClick}
      disabled={disabled}
      data-no-window-drag
    >
      <Trash2 className="size-4" />
    </Button>
  );
}

export function SettingsDeleteDialog({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
  busy = false,
  busyLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  onConfirm: () => void | Promise<void>;
  busy?: boolean;
  busyLabel?: string;
}) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void onConfirm()}
            disabled={busy}
          >
            {busy ? (busyLabel ?? t('common.deleting')) : t('common.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
