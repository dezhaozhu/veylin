import { useCallback, useEffect, useState } from 'react';
import {
  readThreadTextSelection,
  type SelectionToolbarAnchor,
} from '@/lib/thread-selection-ask';
import { useOverlayDismiss } from '@/lib/overlay-dismiss';

const VIEWPORT_SELECTOR = '[data-slot="aui_thread-viewport"]';

export function useThreadSelectionAsk() {
  const [anchor, setAnchor] = useState<SelectionToolbarAnchor | null>(null);

  const refresh = useCallback(() => {
    const viewport = document.querySelector<HTMLElement>(VIEWPORT_SELECTOR);
    if (!viewport) {
      setAnchor(null);
      return;
    }
    setAnchor(readThreadTextSelection(viewport));
  }, []);

  const dismiss = useCallback(() => {
    setAnchor(null);
  }, []);

  useOverlayDismiss(dismiss);

  useEffect(() => {
    const viewport = document.querySelector<HTMLElement>(VIEWPORT_SELECTOR);
    if (!viewport) return;

    const scheduleRefresh = () => {
      requestAnimationFrame(refresh);
    };

    const onMouseUp = (event: MouseEvent) => {
      if (!(event.target instanceof Node) || !viewport.contains(event.target)) return;
      scheduleRefresh();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (!viewport.contains(document.activeElement ?? viewport)) {
        if (event.key === 'Escape') dismiss();
      }
      if (
        event.key === 'Shift' ||
        event.key.startsWith('Arrow') ||
        event.key === 'a' && (event.ctrlKey || event.metaKey)
      ) {
        scheduleRefresh();
      }
    };

    const onScroll = () => dismiss();

    document.addEventListener('mouseup', onMouseUp);
    viewport.addEventListener('keyup', onKeyUp);
    viewport.addEventListener('scroll', onScroll, { passive: true, capture: true });

    return () => {
      document.removeEventListener('mouseup', onMouseUp);
      viewport.removeEventListener('keyup', onKeyUp);
      viewport.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, [dismiss, refresh]);

  return { anchor, dismiss };
};
