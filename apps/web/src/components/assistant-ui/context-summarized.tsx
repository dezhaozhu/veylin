import { makeAssistantDataUI } from '@assistant-ui/react';
import { useTranslation } from 'react-i18next';

/** Cursor-style inline notice when auto-compaction rewrote model context. */
function ContextSummarizedLine() {
  const { t } = useTranslation();
  return (
    <div role="status" className="text-muted-foreground text-sm">
      {t('thread.contextSummarized')}
    </div>
  );
}

export const ContextSummarizedDataUI = makeAssistantDataUI({
  name: 'veylin-context-summarized',
  render: ContextSummarizedLine,
});

export function ContextSummarizedRenderers() {
  return <ContextSummarizedDataUI />;
}
