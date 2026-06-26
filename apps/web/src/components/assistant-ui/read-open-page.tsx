import { makeAssistantToolUI } from '@assistant-ui/react';
import { GlobeIcon, LoaderIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { readWebView, truncatePageContent } from '@/lib/tauri-web-view';
import { getActiveWebTabId } from '@/lib/panel-tabs-storage';

interface ReadOpenPageArgs {
  mode?: 'text' | 'html';
  maxChars?: number;
}

interface ReadOpenPageResult {
  url?: string;
  title?: string;
  content?: string;
  truncated?: boolean;
  error?: string;
  mode?: 'text' | 'html';
}

export const ReadOpenPageToolUI = makeAssistantToolUI<ReadOpenPageArgs, ReadOpenPageResult>({
  toolName: 'read_open_page',
  display: 'standalone',
  render: ({ args, addResult, status, result }) => {
    const { t } = useTranslation();
    const startedRef = useRef(false);
    const mode = args?.mode ?? 'text';
    const maxChars = args?.maxChars ?? 50_000;

    useEffect(() => {
      if (status.type !== 'running' || !addResult || startedRef.current || result) return;
      startedRef.current = true;

      void (async () => {
        try {
          const page = await readWebView(mode, getActiveWebTabId() ?? undefined);
          const { content, truncated } = truncatePageContent(page.content, maxChars);
          addResult({
            mode,
            url: page.url,
            title: page.title,
            content,
            truncated,
          });
        } catch (e) {
          addResult({
            mode,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      })();
    }, [status.type, addResult, mode, maxChars, result]);

    const running = status.type === 'running' && !result;
    const done = status.type === 'complete';
    let hostname = result?.url ?? '';
    try {
      if (result?.url) hostname = new URL(result.url).hostname;
    } catch {
      /* keep raw */
    }

    return (
      <div className="border-border/60 bg-muted/20 my-2 rounded-lg border p-3 text-xs">
        <div className="text-muted-foreground mb-2 flex items-center gap-1.5 font-medium">
          {running ? (
            <LoaderIcon className="size-3.5 animate-spin" />
          ) : (
            <GlobeIcon className="size-3.5" />
          )}
          {running
            ? t('readPage.reading', { mode })
            : result?.error
              ? t('readPage.failed')
              : t('readPage.read', { host: hostname || t('readPage.currentPage') })}
        </div>
        {done && result?.error && (
          <p className="text-destructive whitespace-pre-wrap">{result.error}</p>
        )}
        {done && result?.title && !result.error && (
          <p className="text-muted-foreground mb-1">
            <span className="font-medium text-foreground">{t('readPage.titleLabel')}</span>
            {result.title}
          </p>
        )}
        {done && result?.url && !result.error && (
          <p className="text-muted-foreground mb-2 truncate">
            <span className="font-medium text-foreground">{t('readPage.urlLabel')}</span>
            {result.url}
          </p>
        )}
        {done && result?.content && !result.error && (
          <div className="border-border/40 bg-background/60 max-h-48 overflow-y-auto rounded border p-2 whitespace-pre-wrap">
            {result.content}
          </div>
        )}
        {done && result?.truncated && (
          <p className="text-muted-foreground mt-1.5">
            {t('readPage.truncated', { chars: maxChars.toLocaleString() })}
          </p>
        )}
      </div>
    );
  },
});
