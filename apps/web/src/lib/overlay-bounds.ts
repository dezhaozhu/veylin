import { useEffect, useState } from 'react';

export type OverlayBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

function boundsEqual(a: OverlayBounds | null, b: OverlayBounds | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.height === b.height
  );
}

export function readElementBounds(el: Element | null): OverlayBounds | null {
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;
  return {
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

/** Chat column host — stays clear of the native right-panel webview. */
export function resolveChatColumnElement(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>('[data-slot="sidebar-inset"]') ??
    document.querySelector<HTMLElement>('[data-slot="chat-workspace"]')
  );
}

function collectLayoutRoots(): Element[] {
  const roots = [
    document.querySelector('[data-slot="chat-workspace"]'),
    document.querySelector('[data-slot="sidebar-inset"]'),
    document.querySelector('[data-slot="sidebar"][data-side="left"]'),
    document.querySelector('[data-slot="sidebar"][data-side="right"]'),
    document.querySelector(
      '[data-slot="sidebar"][data-side="right"] [data-slot="sidebar-container"]',
    ),
    document.body,
  ];
  return roots.filter((node): node is Element => Boolean(node));
}

/**
 * Fire whenever column layout may change: sidebar drag, collapse transitions,
 * window resize. Window `resize` alone misses drag handles.
 */
export function subscribeLayoutSync(onSync: () => void): () => void {
  let raf = 0;
  const resizeObserver = new ResizeObserver(() => schedule());

  const run = () => {
    raf = 0;
    onSync();
  };

  const schedule = () => {
    if (raf) return;
    raf = window.requestAnimationFrame(run);
  };

  for (const root of collectLayoutRoots()) resizeObserver.observe(root);

  const onPointerMove = () => {
    if (!document.body.classList.contains('sidebar-column-resizing')) return;
    schedule();
  };

  window.addEventListener('resize', schedule);
  document.addEventListener('transitionend', schedule, true);
  // Live drag: sidebar sets `sidebar-column-resizing` on body while dragging.
  document.addEventListener('pointermove', onPointerMove, true);

  schedule();

  return () => {
    if (raf) window.cancelAnimationFrame(raf);
    resizeObserver.disconnect();
    window.removeEventListener('resize', schedule);
    document.removeEventListener('transitionend', schedule, true);
    document.removeEventListener('pointermove', onPointerMove, true);
  };
}

/**
 * Keep overlay bounds in sync while sidebars resize/collapse.
 */
export function subscribeLayoutBounds(
  resolveTarget: () => Element | null,
  onBounds: (bounds: OverlayBounds | null) => void,
): () => void {
  return subscribeLayoutSync(() => {
    onBounds(readElementBounds(resolveTarget()));
  });
}

/** React helper: live bounds for the chat column while `enabled`. */
export function useChatColumnBounds(enabled: boolean): OverlayBounds | null {
  const [bounds, setBounds] = useState<OverlayBounds | null>(null);

  useEffect(() => {
    if (!enabled) {
      setBounds(null);
      return;
    }
    return subscribeLayoutBounds(resolveChatColumnElement, (next) => {
      setBounds((prev) => (boundsEqual(prev, next) ? prev : next));
    });
  }, [enabled]);

  return bounds;
}
