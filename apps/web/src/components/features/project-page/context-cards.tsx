/**
 * 上下文卡片(形状取自 Claude 的 Context 栏,调子按 Veylin:安静、无彩色角标)。
 *
 * 一张卡要一眼答三个问题:**这是什么文件、从哪来、有多大**。名字给两行,类型做成
 * 角标,PDF 直接把封面画出来 —— 人是"认出"文件,不是读一列文本。
 *
 * 封面只对 PDF 取,而且**滚到跟前才取**:一屏十几张卡,开屏就渲染十几页 PDF
 * 会把面板卡住(文档面板那边已经踩过一次,分页也是这么做的)。
 */
import { FileTextIcon, FolderIcon } from 'lucide-react';
import { useEffect, useState, type FC } from 'react';

import { cn } from '@/lib/utils';
import type { ContextCard } from '@/lib/context-cards';

const PdfCover: FC<{ projectId: string; name: string }> = ({ projectId, name }) => {
  const [src, setSrc] = useState<string | null>(null);
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    if (seen || !el) return;
    const io = new IntersectionObserver(
      (entries) => entries.some((e) => e.isIntersecting) && setSeen(true),
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen, el]);

  useEffect(() => {
    if (!seen || src) return;
    let alive = true;
    void (async () => {
      const q = new URLSearchParams({ projectId, name, page: '1' });
      const res = await fetch(`/api/project/file/page?${q}`).catch(() => null);
      const body = (await res?.json().catch(() => ({}))) as { dataUrl?: string };
      // 取不到封面就让它空着 —— 这里是锦上添花,不该为它摆一句错误。
      if (alive && body?.dataUrl) setSrc(body.dataUrl);
    })();
    return () => { alive = false; };
  }, [seen, src, projectId, name]);

  return (
    <div ref={setEl} className="bg-muted/40 mb-1.5 h-14 shrink-0 overflow-hidden rounded">
      {src ? <img src={src} alt="" className="h-14 w-full object-cover object-top" /> : null}
    </div>
  );
};

export const ContextCards: FC<{
  cards: ContextCard[];
  projectId: string;
  onOpenFile: (name: string) => void;
  onOpenFolder: () => void;
}> = ({ cards, projectId, onOpenFile, onOpenFolder }) => (
  <div className="grid grid-cols-2 gap-1.5">
    {cards.map((card) => (
      <button
        key={card.key}
        type="button"
        title={card.name}
        onClick={() => (card.kind === 'folder' ? onOpenFolder() : onOpenFile(card.name))}
        className={cn(
          // **高度不能写死**:带封面的卡比纯文字卡高一截,写死 92px 会把文字压在
          // 封面上叠成一团(实测截图里 PDF 那张就是这样)。min-h 保证空卡不塌,
          // 有封面的自己长高。
          'border-border/70 hover:border-border hover:bg-muted/40 group flex min-h-[92px] flex-col',
          'rounded-lg border p-2 text-left transition-colors',
        )}
      >
        {card.kind === 'file' && card.cover ? (
          <PdfCover projectId={projectId} name={card.name} />
        ) : null}
        <p className="text-foreground line-clamp-2 text-xs leading-snug font-medium break-all">
          {card.kind === 'folder' ? card.name : card.name.replace(/^.*\//, '')}
        </p>
        <p className="text-muted-foreground mt-0.5 line-clamp-1 text-[11px]">
          {card.kind === 'folder' ? `${card.count} 项` : card.meta}
        </p>
        {/* 角标压在卡底:同一位置、同一字号,扫一列就能分出类型。 */}
        <div className="text-muted-foreground mt-auto flex items-center pt-1 text-[10px]">
          {card.kind === 'folder' ? (
            <FolderIcon className="size-3.5" />
          ) : card.badge ? (
            <span className="border-border/70 rounded border px-1 py-px tracking-wide">
              {card.badge}
            </span>
          ) : (
            <FileTextIcon className="size-3.5" />
          )}
        </div>
      </button>
    ))}
  </div>
);
