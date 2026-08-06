import { useEffect, useState, type CSSProperties, type MouseEvent } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { isTauri } from '@/lib/tauri-web-view';
import {
  detectTitlebarPlatform,
  usesCustomCaptionButtons,
} from '@/lib/titlebar-layout';

/** Inline no-drag so WebView2 never treats caption chrome as a drag strip. */
const NO_DRAG_STYLE = { WebkitAppRegion: 'no-drag' } as CSSProperties;

function stopDragGesture(event: MouseEvent) {
  event.stopPropagation();
}

/**
 * Frameless Win/Linux caption buttons (VS Code–style).
 * macOS keeps native traffic lights via Overlay titlebar.
 */
export function WindowCaptionControls({ className }: { className?: string }) {
  const { t } = useTranslation();
  const [maximized, setMaximized] = useState(false);
  const show = isTauri() && usesCustomCaptionButtons(detectTitlebarPlatform());

  useEffect(() => {
    if (!show) return;
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;

    void win.isMaximized().then(setMaximized).catch(() => undefined);
    void win
      .onResized(() => {
        void win.isMaximized().then(setMaximized).catch(() => undefined);
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => undefined);

    return () => {
      unlisten?.();
    };
  }, [show]);

  if (!show) return null;

  const win = () => getCurrentWindow();

  return (
    <div
      data-no-window-drag
      style={NO_DRAG_STYLE}
      className={cn(
        'pointer-events-auto fixed top-0 right-0 z-[60] flex h-9 items-stretch',
        className,
      )}
      onMouseDown={stopDragGesture}
    >
      <button
        type="button"
        aria-label={t('window.minimize')}
        style={NO_DRAG_STYLE}
        className="text-muted-foreground hover:bg-muted hover:text-foreground flex w-[46px] items-center justify-center transition-colors"
        onMouseDown={stopDragGesture}
        onClick={() => {
          void win()
            .minimize()
            .catch((err) => console.error('[window-caption] minimize failed', err));
        }}
      >
        <Minus className="size-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        aria-label={maximized ? t('window.restore') : t('window.maximize')}
        style={NO_DRAG_STYLE}
        className="text-muted-foreground hover:bg-muted hover:text-foreground flex w-[46px] items-center justify-center transition-colors"
        onMouseDown={stopDragGesture}
        onClick={() => {
          void win()
            .toggleMaximize()
            .catch((err) => console.error('[window-caption] toggleMaximize failed', err));
        }}
      >
        {maximized ? (
          <span className="relative size-2.5">
            <span className="border-foreground/70 absolute top-0 right-0 size-2 border" />
            <span className="border-foreground/70 bg-background absolute bottom-0 left-0 size-2 border" />
          </span>
        ) : (
          <Square className="size-2.5" strokeWidth={1.75} />
        )}
      </button>
      <button
        type="button"
        aria-label={t('window.close')}
        style={NO_DRAG_STYLE}
        className="text-muted-foreground hover:bg-destructive hover:text-destructive-foreground flex w-[46px] items-center justify-center transition-colors"
        onMouseDown={stopDragGesture}
        onClick={() => {
          // CloseRequested in Rust hides (tray-style) instead of quitting.
          void win()
            .close()
            .catch((err) => console.error('[window-caption] close failed', err));
        }}
      >
        <X className="size-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
}
