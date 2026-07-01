import { useEffect } from 'react';

export const OVERLAY_DISMISS_EVENT = 'veylin:overlay-dismiss';

export type OverlayDismissDetail = {
  reason: string;
};

export function dispatchOverlayDismiss(reason: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<OverlayDismissDetail>(OVERLAY_DISMISS_EVENT, {
      detail: { reason },
    }),
  );
}

/** Close local overlay/menu state when workspace or thread context changes. */
export function useOverlayDismiss(onDismiss: () => void): void {
  useEffect(() => {
    const handler = () => onDismiss();
    window.addEventListener(OVERLAY_DISMISS_EVENT, handler);
    return () => window.removeEventListener(OVERLAY_DISMISS_EVENT, handler);
  }, [onDismiss]);
}
