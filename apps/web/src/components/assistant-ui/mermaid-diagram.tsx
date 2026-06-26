import mermaid from 'mermaid';
import { useEffect, useId, useState } from 'react';
import { cn } from '@/lib/utils';

let mermaidReady = false;

function ensureMermaidInit() {
  if (mermaidReady || typeof document === 'undefined') return;
  const dark = document.documentElement.classList.contains('dark');
  mermaid.initialize({
    startOnLoad: false,
    theme: dark ? 'dark' : 'neutral',
    securityLevel: 'strict',
    fontFamily: 'inherit',
  });
  mermaidReady = true;
}

export function MermaidDiagram({ code, className }: { code: string; className?: string }) {
  const reactId = useId().replace(/:/g, '');
  const [svg, setSvg] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = code.trim();
    if (!trimmed) return;

    ensureMermaidInit();
    let cancelled = false;
    const renderId = `mermaid-${reactId}-${Date.now()}`;

    void mermaid
      .render(renderId, trimmed)
      .then(({ svg: rendered }) => {
        if (!cancelled) {
          setSvg(rendered);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setSvg('');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [code, reactId]);

  if (error) {
    return (
      <div
        className={cn(
          'aui-md-mermaid-error border-destructive/30 bg-destructive/5 text-destructive my-3 rounded-xl border p-3 text-xs',
          className,
        )}
      >
        {error}
      </div>
    );
  }

  if (!svg) {
    return (
      <div
        className={cn(
          'aui-md-mermaid-loading bg-muted/30 text-muted-foreground my-3 flex min-h-[120px] items-center justify-center rounded-xl border text-xs',
          className,
        )}
      >
        …
      </div>
    );
  }

  return (
    <div
      className={cn(
        'aui-md-mermaid bg-card my-3 overflow-x-auto rounded-xl border p-4 [&_svg]:mx-auto [&_svg]:max-w-full',
        className,
      )}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
