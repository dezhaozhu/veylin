import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { startWindowDrag } from '@/lib/window-drag';

/**
 * Scrollable workspace content column with a top window-drag hit target.
 *
 * `overflow-y-auto` clips negative-margin drag regions into `px-*` gutters, so
 * the hit target lives on `main`. Empty space around centered `max-w-*`
 * children falls through (`pointer-events-none`) onto it.
 *
 * Deliberately omits `data-tauri-drag-region` on the full-width strip: CSS
 * `app-region: drag` is geometric and would steal clicks from header actions
 * stacked above it. JS `startDragging` only runs when the strip is actually hit.
 */
export function WorkspaceMain({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <main
      className={cn(
        'relative min-h-0 min-w-0 flex-1 overflow-y-auto',
        className,
      )}
    >
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 z-0 h-14"
        onMouseDown={startWindowDrag}
      />
      <div className="pointer-events-none relative z-10 px-8 py-6 [&>*]:pointer-events-auto">
        {children}
      </div>
    </main>
  );
}
