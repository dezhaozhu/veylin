'use client';

import mermaid from 'mermaid';
import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { CheckIcon, CopyIcon, Maximize2Icon } from 'lucide-react';
import { TooltipIconButton } from '@/components/assistant-ui/tooltip-icon-button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { copyToClipboard } from '@/lib/copy-to-clipboard';
import { cn } from '@/lib/utils';

let mermaidReady = false;

function cleanupMermaidArtifacts(renderId: string, host?: HTMLElement | null) {
  for (const id of [renderId, `d${renderId}`, `i${renderId}`]) {
    document.getElementById(id)?.remove();
  }
  host?.remove();
}

function createHiddenRenderHost(): HTMLDivElement {
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText =
    'position:fixed;left:-10000px;top:0;width:1px;height:1px;overflow:hidden;visibility:hidden;pointer-events:none';
  document.body.appendChild(host);
  return host;
}

function formatMermaidError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/getAttribute|is not an object/i.test(message)) {
    return '图表渲染失败，请检查 Mermaid 语法是否完整、合法。';
  }
  if (/parse error|syntax error/i.test(message)) {
    return 'Mermaid 语法无法解析，请检查图表定义。';
  }
  return message.length > 200 ? `${message.slice(0, 200)}…` : message;
}

function ensureMermaidInit() {
  if (mermaidReady || typeof document === 'undefined') return;
  const dark = document.documentElement.classList.contains('dark');
  mermaid.initialize({
    startOnLoad: false,
    theme: dark ? 'dark' : 'neutral',
    securityLevel: 'strict',
    fontFamily: 'inherit',
    fontSize: 11,
    // Avoid injecting the built-in "Syntax error in text" SVG into document.body.
    suppressErrorRendering: true,
    // Tighter defaults — chat cards feel oversized with Mermaid's stock spacing.
    flowchart: {
      htmlLabels: true,
      curve: 'basis',
      padding: 6,
      nodeSpacing: 18,
      rankSpacing: 22,
      useMaxWidth: true,
    },
    sequence: {
      useMaxWidth: true,
      boxMargin: 5,
      messageMargin: 22,
      actorMargin: 28,
      noteMargin: 6,
    },
    themeVariables: {
      fontSize: '11px',
    },
  });
  mermaidReady = true;
}

/** Skip render while the model is still streaming an incomplete fence. */
function isLikelyIncompleteMermaid(code: string): boolean {
  const trimmed = code.trim();
  if (!trimmed) return true;
  const lines = trimmed.split('\n');
  if (lines.length < 2) return true;
  const header = lines[0]!.trim().toLowerCase();
  if (!/^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|gitGraph|journey|timeline|mindmap|quadrantChart|sankey-beta|xychart-beta|block-beta|packet-beta|c4context)/i.test(header)) {
    return trimmed.length < 24;
  }
  return false;
}

function MermaidToolbar({
  code,
  onExpand,
}: {
  code: string;
  onExpand: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    if (copied) return;
    const ok = await copyToClipboard(code);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="absolute top-2 right-2 flex items-center gap-0.5">
      <TooltipIconButton tooltip="Expand" onClick={onExpand}>
        <Maximize2Icon className="size-3.5" />
      </TooltipIconButton>
      <TooltipIconButton tooltip="Copy" onClick={onCopy}>
        {copied ? (
          <CheckIcon className="size-3.5" />
        ) : (
          <CopyIcon className="size-3.5" />
        )}
      </TooltipIconButton>
    </div>
  );
}

function MermaidSvg({
  svg,
  className,
  compact = false,
  onMount,
}: {
  svg: string;
  className?: string;
  /** Shrink inline chat cards; expanded dialog stays full size. */
  compact?: boolean;
  onMount?: (node: HTMLDivElement | null) => void;
}) {
  return (
    <div
      ref={onMount}
      className={cn(
        '[&_svg]:mx-auto [&_svg]:block [&_svg]:h-auto [&_svg]:max-w-full',
        compact && '[&_svg]:w-[min(100%,_36rem)]',
        className,
      )}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

function MermaidExpandedView({ svg, open }: { svg: string; open: boolean }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; active: boolean }>({
    x: 0,
    y: 0,
    active: false,
  });
  const pointerIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, [open]);

  useEffect(() => {
    if (open) return;
    dragRef.current.active = false;
    const viewport = viewportRef.current;
    const pointerId = pointerIdRef.current;
    if (viewport && pointerId != null && viewport.hasPointerCapture(pointerId)) {
      viewport.releasePointerCapture(pointerId);
    }
    pointerIdRef.current = null;
  }, [open]);

  useEffect(() => {
    return () => {
      dragRef.current.active = false;
      const viewport = viewportRef.current;
      const pointerId = pointerIdRef.current;
      if (viewport && pointerId != null && viewport.hasPointerCapture(pointerId)) {
        viewport.releasePointerCapture(pointerId);
      }
      pointerIdRef.current = null;
    };
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !open) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta = event.deltaY > 0 ? -0.1 : 0.1;
      setScale((currentScale) => clampZoom(currentScale + delta));
    };

    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, [open]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragRef.current = { x: event.clientX, y: event.clientY, active: true };
    pointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    const dx = event.clientX - dragRef.current.x;
    const dy = event.clientY - dragRef.current.y;
    dragRef.current = { x: event.clientX, y: event.clientY, active: true };
    setOffset((current) => ({ x: current.x + dx, y: current.y + dy }));
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current.active = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    pointerIdRef.current = null;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div
        ref={viewportRef}
        className="bg-muted/20 relative min-h-[min(70vh,640px)] flex-1 cursor-grab overflow-hidden rounded-md border active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => {
          setScale(1);
          setOffset({ x: 0, y: 0 });
        }}
      >
        <div
          className="flex min-h-full min-w-full items-center justify-center p-6"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          }}
        >
          <MermaidSvg svg={svg} className="pointer-events-none select-none" />
        </div>
      </div>
      <p className="text-muted-foreground text-xs">
        滚轮缩放 · 拖拽平移 · 双击重置 · {Math.round(scale * 100)}%
      </p>
    </div>
  );
}

export function MermaidDiagram({ code, className }: { code: string; className?: string }) {
  const reactId = useId().replace(/:/g, '');
  const [svg, setSvg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const bindFunctionsRef = useRef<((element: Element) => void) | undefined>(undefined);
  const displayRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!svg || !displayRef.current || !bindFunctionsRef.current) return;
    bindFunctionsRef.current(displayRef.current);
  }, [svg]);

  useEffect(() => {
    const trimmed = code.trim();
    if (!trimmed || isLikelyIncompleteMermaid(trimmed)) {
      setSvg('');
      setError(null);
      bindFunctionsRef.current = undefined;
      return;
    }

    ensureMermaidInit();
    let cancelled = false;
    const renderId = `mermaid-${reactId}-${Date.now()}`;
    const host = createHiddenRenderHost();

    const timer = window.setTimeout(() => {
      void mermaid
        .render(renderId, trimmed, host)
        .then(({ svg: rendered, bindFunctions }) => {
          if (!cancelled) {
            bindFunctionsRef.current = bindFunctions;
            setSvg(rendered);
            setError(null);
          }
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            bindFunctionsRef.current = undefined;
            setError(formatMermaidError(err));
            setSvg('');
          }
        })
        .finally(() => {
          cleanupMermaidArtifacts(renderId, host);
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      cleanupMermaidArtifacts(renderId, host);
    };
  }, [code, reactId]);

  if (error) {
    return (
      <div
        className={cn(
          'aui-md-mermaid-error border-destructive/30 bg-destructive/5 text-destructive my-2 rounded-lg border p-3 text-xs',
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
          'aui-md-mermaid-loading bg-muted/30 text-muted-foreground relative my-2 flex min-h-[72px] items-center justify-center rounded-lg border text-xs',
          className,
        )}
      >
        …
      </div>
    );
  }

  return (
    <>
      <div
        className={cn(
          'aui-md-mermaid bg-card relative my-2 overflow-x-auto rounded-lg border p-2 pr-11',
          className,
        )}
      >
        <MermaidToolbar code={code} onExpand={() => setExpanded(true)} />
        <MermaidSvg
          svg={svg}
          compact
          onMount={(node) => {
            displayRef.current = node;
          }}
        />
      </div>
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="flex max-h-[90vh] max-w-5xl flex-col gap-4 overflow-hidden sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Diagram</DialogTitle>
          </DialogHeader>
          <MermaidExpandedView svg={svg} open={expanded} />
        </DialogContent>
      </Dialog>
    </>
  );
}
