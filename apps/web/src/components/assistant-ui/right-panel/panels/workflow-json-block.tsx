import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { formatWorkflowValue } from './workflow-run-utils';

export function WorkflowJsonBlock({
  value,
  className,
  maxHeight = 'max-h-48',
}: {
  value: unknown;
  className?: string;
  maxHeight?: string;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const text = formatWorkflowValue(value);

  if (value === undefined) {
    return <p className="text-muted-foreground text-[11px]">{t('wf.run.noOutput')}</p>;
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className={cn('relative', className)}>
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground absolute right-1 top-1 z-10 rounded p-0.5"
        title={t('wf.run.copy')}
        onClick={() => void copy()}
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      </button>
      <pre
        className={cn(
          'bg-muted/50 overflow-auto rounded border p-2 pr-7 font-mono text-[10px] leading-relaxed whitespace-pre-wrap break-all',
          maxHeight,
        )}
      >
        {text || t('wf.run.emptyOutput')}
      </pre>
    </div>
  );
}
