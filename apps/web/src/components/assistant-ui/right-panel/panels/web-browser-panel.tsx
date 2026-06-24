import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { isTauri, openWebView } from '@/lib/tauri-web-view';
import type { PanelContentProps } from '../panel-types';

/** Control panel to open intranet pages in the docked Tauri web-view window. */
export function WebBrowserPanel({ tab, updateState }: PanelContentProps) {
  const { t } = useTranslation();
  const storedUrl = typeof tab.state?.url === 'string' ? tab.state.url : '';
  const [input, setInput] = useState(storedUrl);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleOpen = useCallback(async () => {
    const url = input.trim();
    if (!url) {
      setError(t('web.enterUrl'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await openWebView(url);
      updateState({ url });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [input, updateState, t]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleOpen();
          }}
          placeholder={t('web.urlPlaceholder')}
          className="h-8 text-xs"
          disabled={loading}
        />
        <Button
          type="button"
          size="sm"
          className="h-8 shrink-0 px-3 text-xs"
          disabled={loading || !isTauri()}
          onClick={() => void handleOpen()}
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : t('web.open')}
        </Button>
      </div>

      {storedUrl && !error && (
        <p className="text-muted-foreground truncate text-[11px]">
          {t('web.lastOpened')}
          <span className="text-foreground">{storedUrl}</span>
        </p>
      )}

      {error && <p className="text-destructive text-xs whitespace-pre-wrap">{error}</p>}
    </div>
  );
}
