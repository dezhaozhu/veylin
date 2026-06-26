import { startWindowDrag } from '@/lib/window-drag';

/** Transparent top strip for workspace panels (settings/customize/automate). */
export function WorkspacePanelDragOverlay() {
  return (
    <div
      aria-hidden
      data-tauri-drag-region
      className="pointer-events-auto absolute inset-x-0 top-0 z-20 h-8"
      onMouseDown={startWindowDrag}
    />
  );
}
