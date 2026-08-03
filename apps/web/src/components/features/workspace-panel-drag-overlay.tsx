import { startWindowDrag } from '@/lib/window-drag';
import { titlebarTrailingInset } from '@/lib/titlebar-layout';

/** Transparent top strip for workspace panels (settings/customize/automate). */
export function WorkspacePanelDragOverlay() {
  return (
    <div
      aria-hidden
      data-tauri-drag-region
      className="pointer-events-auto absolute top-0 z-20 h-8"
      style={{
        left: 'min(560px, calc(100vw - 96px))',
        right: titlebarTrailingInset(),
      }}
      onMouseDown={startWindowDrag}
    />
  );
}
