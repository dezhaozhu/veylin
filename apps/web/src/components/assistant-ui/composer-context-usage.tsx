'use client';

import {
  computeContextUsageSnapshot,
  contextUsageSignature,
  formatTokenCount,
  getLastTokenUsageFromMessages,
  measureContextTokenCount,
  type ApiUsageLike,
} from '@/lib/context-usage';
import {
  getChatSettings,
  onChatSettingsChange,
  type ModelKey,
} from '@/lib/chat-settings';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useAuiState } from '@assistant-ui/react';
import { useEffect, useMemo, useState, type CSSProperties, type FC } from 'react';

function serializeLastUsageKey(messages: readonly unknown[]): string {
  const usage = getLastTokenUsageFromMessages(messages);
  if (!usage) return '';
  return `${usage.input_tokens}|${usage.cache_creation_input_tokens ?? 0}|${usage.cache_read_input_tokens ?? 0}|${usage.output_tokens}`;
}

function parseLastUsageKey(key: string): ApiUsageLike | null {
  if (!key) return null;
  const parts = key.split('|').map(Number);
  const input = parts[0];
  const cacheCreate = parts[1];
  const cacheRead = parts[2];
  const output = parts[3];
  if (input == null || output == null || !Number.isFinite(input) || !Number.isFinite(output)) {
    return null;
  }
  return {
    input_tokens: input,
    output_tokens: output,
    cache_creation_input_tokens: Number.isFinite(cacheCreate) ? cacheCreate : 0,
    cache_read_input_tokens: Number.isFinite(cacheRead) ? cacheRead : 0,
  };
}

/** Gray context ring — usage % via conic gradient, no center label. */
export const ComposerContextUsage: FC<{ className?: string }> = ({ className }) => {
  const [model, setModel] = useState<ModelKey>(() => getChatSettings().model);

  useEffect(() => onChatSettingsChange((s) => setModel(s.model)), []);

  // Cheap signature selector re-runs every token, but the expensive full-transcript
  // token scan below is gated on the signature so it does not run on every token.
  const messages = useAuiState((s) => s.thread.messages);
  const composerText = useAuiState((s) => s.composer.text);
  const usageSignature = useAuiState((s) =>
    contextUsageSignature(s.thread.messages, s.composer.text),
  );

  const estimatedTokens = useMemo(
    () => measureContextTokenCount(messages, composerText),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [usageSignature],
  );

  const lastUsageKey = useAuiState((s) => serializeLastUsageKey(s.thread.messages));

  const snapshot = useMemo(() => {
    const lastUsage = parseLastUsageKey(lastUsageKey);
    return computeContextUsageSnapshot(estimatedTokens, model, lastUsage);
  }, [estimatedTokens, lastUsageKey, model]);

  const tooltip = `${snapshot.usedPercent}% · ${formatTokenCount(snapshot.estimatedTokens)} / ${formatTokenCount(snapshot.contextWindow)} context used`;

  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={tooltip}
            className={cn(
              'relative size-3.5 shrink-0 rounded-full border-0 bg-transparent p-0',
              className,
            )}
            style={
              {
                '--context-used': snapshot.usedPercent,
                background: `
                  radial-gradient(circle, var(--color-background) 54%, transparent 56%),
                  conic-gradient(
                    from 180deg,
                    var(--color-muted-foreground) calc(var(--context-used) * 1%),
                    var(--color-border) 0
                  )
                `,
              } as CSSProperties
            }
          />
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
