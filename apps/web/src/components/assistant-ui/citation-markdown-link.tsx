import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { usePanelTabs } from '@/components/assistant-ui/right-panel/panel-tabs-context';

export function CitationMarkdownLink({
  refIndex,
  children,
}: {
  refIndex: number;
  children: ReactNode;
}) {
  const { focusRagCitation } = usePanelTabs();

  return (
    <button
      type="button"
      className={cn(
        'text-primary hover:text-primary/80 inline align-baseline font-medium underline underline-offset-2',
      )}
      title={`引用 [${refIndex}]`}
      onClick={() => focusRagCitation({ refIndex })}
    >
      {children}
    </button>
  );
}
