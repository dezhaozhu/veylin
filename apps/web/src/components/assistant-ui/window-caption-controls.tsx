import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { isTauri } from '@/lib/tauri-web-view';
import {
  detectTitlebarPlatform,
  usesCustomCaptionButtons,
} from '@/lib/titlebar-layout';

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
      className={cn(
        'pointer-events-auto fixed top-0 right-0 z-[60] flex h-8 items-stretch',
        className,
      )}
    >
      <button
        type="button"
        aria-label={t('window.minimize')}
        className="text-muted-foreground hover:bg-muted hover:text-foreground flex w-[46px] items-center justify-center transition-colors"
        onClick={() => void win().minimize().catch(() => undefined)}
      >
        <Minus className="size-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        aria-label={maximized ? t('window.restore') : t('window.maximize')}
        className="text-muted-foreground hover:bg-muted hover:text-foreground flex w-[46px] items-center justify-center transition-colors"
        onClick={() => void win().toggleMaximize().catch(() => undefined)}
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
        className="text-muted-foreground hover:bg-destructive hover:text-destructive-foreground flex w-[46px] items-center justify-center transition-colors"
        onClick={() => void win().close().catch(() => undefined)}
      >
        <X className="size-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
}
