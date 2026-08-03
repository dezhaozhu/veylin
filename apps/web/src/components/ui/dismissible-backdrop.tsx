import { useEffect } from 'react';
import { useOverlayDismiss } from '@/lib/overlay-dismiss';

/** Full-screen dismiss layer for portaled menus and dropdowns. */
export function DismissibleBackdrop({
  ariaLabel,
  onClose,
  className = 'fixed inset-0 z-[200] cursor-default bg-transparent',
}: {
  ariaLabel: string;
  onClose: () => void;
  className?: string;
}) {
  useOverlayDismiss(onClose);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <button
      type="button"
      className={className}
      aria-label={ariaLabel}
      onClick={onClose}
    />
  );
}
