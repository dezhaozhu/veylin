import { makeAssistantToolUI } from '@assistant-ui/react';
import { LoaderIcon } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ToolFallbackArgs,
  ToolFallbackContent,
  ToolFallbackResult,
  ToolFallbackRoot,
  ToolFallbackTrigger,
} from '@/components/assistant-ui/tool-fallback';
import { useToolGroupStreaming } from '@/components/assistant-ui/tool-group';
import {
  getReadOpenPageSubmittedVersion,
  isReadOpenPageSubmitted,
  subscribeReadOpenPageSubmitted,
  type ReadOpenPageResult,
} from '@/lib/read-open-page-submit-bridge';
import { cn } from '@/lib/utils';

interface ReadOpenPageArgs {
  tabId?: string;
  mode?: 'text' | 'html';
  maxChars?: number;
}

function hostnameOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function formatReadOpenPageResult(
  result: ReadOpenPageResult | undefined,
  t: (key: string, opts?: Record<string, unknown>) => string,
  maxChars: number,
): string | undefined {
  if (!result || result.error) return undefined;

  const lines: string[] = [];
  const host = hostnameOf(result.url);
  if (host) lines.push(t('readPage.read', { host }));
  if (result.title) lines.push(`${t('readPage.titleLabel')}${result.title}`);
  if (result.url) lines.push(`${t('readPage.urlLabel')}${result.url}`);
  if (result.content != null) {
    lines.push(result.content || t('readPage.emptyContent'));
  }
  if (result.truncated) {
    lines.push(t('readPage.truncated', { chars: maxChars.toLocaleString() }));
  }
  return lines.length > 0 ? lines.join('\n') : undefined;
}

/**
 * Same chrome as generic tools (ToolFallback), with bridge-aware running/stopped
 * state for the desktop WebView read.
 */
export const ReadOpenPageToolUI = makeAssistantToolUI<ReadOpenPageArgs, ReadOpenPageResult>({
  toolName: 'read_open_page',
  render: ({ args, argsText, addResult, status, result, toolCallId }) => {
    const { t } = useTranslation();
    const inStreamingGroup = useToolGroupStreaming();
    const [open, setOpen] = useState(false);
    const maxChars = args?.maxChars ?? 50_000;

    useSyncExternalStore(
      subscribeReadOpenPageSubmitted,
      getReadOpenPageSubmittedVersion,
      getReadOpenPageSubmittedVersion,
    );
    const bridgeDone = isReadOpenPageSubmitted(toolCallId);

    const incompleteReason =
      status.type === 'incomplete'
        ? String((status as { reason?: string }).reason ?? '')
        : '';
    const interrupted =
      Boolean(result?.error?.includes('Interrupted')) ||
      incompleteReason === 'cancelled' ||
      incompleteReason === 'error';

    const displayError =
      result?.error ??
      (interrupted && !result ? 'Interrupted by user.' : undefined);

    const running =
      !result &&
      !bridgeDone &&
      !displayError &&
      !interrupted &&
      (status.type === 'running' || status.type === 'requires-action');

    const stopped =
      (!result && !bridgeDone && !running && !displayError && (!addResult || interrupted)) ||
      (bridgeDone && !result && !displayError);

    const isCancelled =
      interrupted ||
      stopped ||
      (status.type === 'incomplete' && status.reason === 'cancelled');

    const triggerStatus = running
      ? ({ type: 'running' } as const)
      : isCancelled
        ? ({ type: 'incomplete', reason: 'cancelled' } as const)
        : displayError
          ? ({ type: 'incomplete', reason: 'error', error: new Error(displayError) } as const)
          : status.type === 'complete'
            ? ({ type: 'complete' } as const)
            : status;

    const formattedResult =
      displayError || isCancelled
        ? undefined
        : formatReadOpenPageResult(result, t, maxChars);
    const resultErrorText = displayError ?? (stopped ? t('readPage.stopped') : null);

    if (inStreamingGroup) {
      return (
        <div
          data-slot="tool-fallback-inline"
          className="aui-tool-fallback-inline text-muted-foreground/50 text-base font-normal leading-snug"
        >
          <div className="flex items-center gap-1.5">
            {running ? (
              <LoaderIcon className="size-4 shrink-0 animate-spin opacity-70" />
            ) : null}
            <span className={cn('font-normal', isCancelled && 'line-through')}>
              read_open_page
            </span>
          </div>
          {argsText ? (
            <pre className="mt-1 max-h-48 overflow-y-auto font-sans text-base leading-snug whitespace-pre-wrap">
              {argsText}
            </pre>
          ) : null}
          {resultErrorText ? (
            <pre className="mt-1 max-h-48 overflow-y-auto font-sans text-base leading-snug whitespace-pre-wrap">
              {resultErrorText}
            </pre>
          ) : formattedResult ? (
            <pre className="mt-1 max-h-48 overflow-y-auto font-sans text-base leading-snug whitespace-pre-wrap">
              {formattedResult}
            </pre>
          ) : null}
        </div>
      );
    }

    return (
      <ToolFallbackRoot open={open} onOpenChange={setOpen}>
        <ToolFallbackTrigger toolName="read_open_page" status={triggerStatus} />
        <ToolFallbackContent>
          <ToolFallbackArgs
            argsText={argsText}
            className={cn(isCancelled && 'opacity-60')}
          />
          <ToolFallbackResult
            result={formattedResult}
            errorText={resultErrorText}
          />
        </ToolFallbackContent>
      </ToolFallbackRoot>
    );
  },
});
