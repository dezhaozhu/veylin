import { CornerDownLeftIcon, XIcon } from 'lucide-react';
import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { previewQuotedText } from '@/lib/thread-selection-ask';
import { usePendingQuote } from '@/lib/use-composer-settings';

/** Quote chip inside the composer shell — not raw `>` in the textarea. */
export const ComposerQuoteBar: FC = () => {
  const { t } = useTranslation();
  const { pendingQuote, setPendingQuote } = usePendingQuote();
  if (!pendingQuote?.trim()) return null;

  const preview = previewQuotedText(pendingQuote);

  return (
    <div
      className="bg-muted/60 text-muted-foreground mx-1 mt-0.5 flex items-center gap-2 rounded-xl px-2.5 py-1.5"
      aria-label={t('thread.selectionQuote')}
    >
      <CornerDownLeftIcon className="size-3.5 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1 truncate text-xs leading-5" title={pendingQuote}>
        “{preview}”
      </p>
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground flex size-6 shrink-0 items-center justify-center rounded-full"
        aria-label={t('thread.selectionQuoteRemove')}
        onClick={() => setPendingQuote(null)}
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
};
