/**
 * 右侧文档面板 —— **读**,不是编辑。
 *
 * 为什么值得占一个 tab:一份工艺说明的用处是**摊在旁边对照着看**排产结果,
 * 而不是每次点开一个盖住聊天的浮层、看完关掉、下一个问题再点开一次。
 *
 * 和表格 tab 的区别要说清楚:表格(AG-Grid)是**编辑面** —— 改、出草案、预览、
 * 提交、能回滚。文档没有对应的东西,也不该造一个:没人要在这里编辑一份 docx
 * 再写回去。要改,走"改在副本上、按需导出"那条路,原件永远不动。
 *
 * **只有 PDF 分页**。Word 转出来的 HTML 是连续的流,给它编页码是编的,人会拿着
 * "第 3 页"去对原文然后发现对不上。
 */
import { useEffect, useState, type FC } from 'react';

import { DocumentPreview } from '@/components/features/document-preview';
import type { PreviewPayload } from '@/lib/document-preview';
import type { PanelContentProps } from '../panel-types';

type DocState = { projectId?: string; name?: string };

type Load =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; payload: PreviewPayload }
  | { state: 'error'; message: string };

/** 一页 PDF。滚到跟前才去取 —— 一份 200 页的标书不该在打开的瞬间全渲染。 */
const PdfPage: FC<{ projectId: string; name: string; page: number }> = ({ projectId, name, page }) => {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [seen, setSeen] = useState(page <= 2);
  const [el, setEl] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (seen || !el) return;
    const io = new IntersectionObserver(
      (entries) => entries.some((e) => e.isIntersecting) && setSeen(true),
      { rootMargin: '400px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen, el]);

  useEffect(() => {
    if (!seen || src || failed) return;
    let alive = true;
    void (async () => {
      const q = new URLSearchParams({ projectId, name, page: String(page) });
      const res = await fetch(`/api/project/file/page?${q}`);
      const body = (await res.json().catch(() => ({}))) as { dataUrl?: string };
      if (!alive) return;
      // 画不出来就说这一页画不出来 —— 留一块空白会被当成"这页本来是白的"。
      if (body.dataUrl) setSrc(body.dataUrl);
      else setFailed(true);
    })();
    return () => { alive = false; };
  }, [seen, src, failed, projectId, name, page]);

  return (
    <div ref={setEl} className="relative">
      {src ? (
        <img src={src} alt={`第 ${page} 页`} className="border-border w-full rounded border shadow-sm" />
      ) : (
        <div className="border-border text-muted-foreground flex h-64 items-center justify-center rounded border border-dashed text-xs">
          {failed ? `第 ${page} 页画不出来` : `第 ${page} 页…`}
        </div>
      )}
      <span className="bg-foreground/70 text-background absolute right-2 bottom-2 rounded px-1.5 py-0.5 text-[10px]">
        {page}
      </span>
    </div>
  );
};

export const DocPanel: FC<PanelContentProps> = ({ tab }) => {
  const { projectId, name } = (tab.state ?? {}) as DocState;
  const [load, setLoad] = useState<Load>({ state: 'idle' });

  useEffect(() => {
    if (!projectId || !name) { setLoad({ state: 'idle' }); return; }
    let alive = true;
    setLoad({ state: 'loading' });
    void (async () => {
      try {
        const q = new URLSearchParams({ projectId, name });
        const res = await fetch(`/api/project/file?${q}`);
        const body = (await res.json()) as PreviewPayload & { error?: string };
        if (!alive) return;
        if (!res.ok || body.error) { setLoad({ state: 'error', message: body.error ?? '读不到这个文件' }); return; }
        setLoad({ state: 'ready', payload: body });
      } catch (err) {
        if (alive) setLoad({ state: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => { alive = false; };
  }, [projectId, name]);

  if (!projectId || !name) {
    return (
      <p className="text-muted-foreground p-6 text-sm">
        在项目的上下文清单里选一份文件,点「在右侧打开」。
      </p>
    );
  }
  if (load.state === 'loading' || load.state === 'idle') {
    return <p className="text-muted-foreground p-6 text-sm">读取中…</p>;
  }
  if (load.state === 'error') {
    return <p className="text-muted-foreground p-6 text-sm leading-relaxed">{load.message}</p>;
  }

  const pages = load.payload.pageCount ?? 0;
  return (
    <div className="h-full overflow-auto p-4">
      {pages > 1 ? (
        <>
          <p className="text-muted-foreground mb-2 text-xs">共 {pages} 页</p>
          <div className="space-y-3">
            {Array.from({ length: pages }, (_, i) => (
              <PdfPage key={i} projectId={projectId} name={name} page={i + 1} />
            ))}
          </div>
        </>
      ) : (
        <DocumentPreview name={name} payload={load.payload} />
      )}
    </div>
  );
};
