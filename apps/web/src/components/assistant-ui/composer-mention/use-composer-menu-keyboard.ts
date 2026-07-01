import { useEffect } from 'react';
import { isImeComposing } from '@/lib/composer-submit-keys';

export function useComposerMenuKeyboard(options: {
  open: boolean;
  itemCount: number;
  activeIndex: number;
  setActiveIndex: (fn: (i: number) => number) => void;
  onActivate: (index: number) => void;
  onClose: () => void;
  onBack?: () => void;
  inSubmenu?: boolean;
}) {
  const { open, itemCount, activeIndex, setActiveIndex, onActivate, onClose, onBack, inSubmenu } =
    options;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (isImeComposing(event)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (inSubmenu && onBack) {
          onBack();
          return;
        }
        onClose();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((i) => (i + 1) % Math.max(itemCount, 1));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex(
          (i) => (i - 1 + Math.max(itemCount, 1)) % Math.max(itemCount, 1),
        );
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        onActivate(activeIndex);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, itemCount, activeIndex, setActiveIndex, onActivate, onClose, onBack, inSubmenu]);
}
