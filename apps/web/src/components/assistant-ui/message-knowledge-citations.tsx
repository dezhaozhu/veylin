import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, FileText } from 'lucide-react';
import { useAuiState } from '@assistant-ui/react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  extractKnowledgeCitations,
  type KnowledgeCitation,
} from '@/lib/knowledge-citations';

function truncateFilename(name: string, max = 48): string {
  if (name.length <= max) return name;
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  const base = name.slice(0, max - ext.length - 3);
  return `${base}...${ext}`;
}

function CitationPreviewDialog({
  citation,
  open,
  onOpenChange,
}: {
  citation: KnowledgeCitation | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();

  if (!citation) return null;

  const active = citation;

  function copySnippet() {
    const text = `${active.source} (offset ${active.offset})\n${active.text}`;
    void navigator.clipboard?.writeText(text);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="truncate pr-6 text-base" title={active.source}>
            {active.source}
          </DialogTitle>
          <DialogDescription>
            offset {active.offset}
            {active.score != null ? ` · score ${active.score.toFixed(2)}` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="text-muted-foreground max-h-56 overflow-y-auto rounded-lg bg-muted/40 p-3 text-xs leading-relaxed whitespace-pre-wrap">
          {active.text}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={copySnippet}>
            <Copy className="size-3.5" />
            {t('citations.copySnippet')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MessageKnowledgeCitations() {
  const { t } = useTranslation();
  const parts = useAuiState((s) => s.message.parts);
  const citations = useMemo(() => extractKnowledgeCitations(parts), [parts]);
  const [preview, setPreview] = useState<KnowledgeCitation | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  if (citations.length === 0) return null;

  function openPreview(citation: KnowledgeCitation) {
    setPreview(citation);
    setDialogOpen(true);
  }

  return (
    <>
      <div
        data-slot="aui_message-knowledge-citations"
        className="border-border/60 mt-1 border-t pt-2.5"
      >
        <div className="text-foreground mb-1.5 text-sm">{t('citations.heading')}</div>
        <ul className="flex flex-col gap-1">
          {citations.map((citation) => (
            <li key={`${citation.chunkId}-${citation.source}`}>
              <button
                type="button"
                className={cn(
                  'text-primary hover:text-primary/80 inline-flex max-w-full min-w-0 items-center gap-1.5 text-left text-sm transition-colors hover:underline',
                )}
                title={citation.source}
                onClick={() => openPreview(citation)}
              >
                <FileText className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{truncateFilename(citation.source)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <CitationPreviewDialog
        citation={preview}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </>
  );
}
