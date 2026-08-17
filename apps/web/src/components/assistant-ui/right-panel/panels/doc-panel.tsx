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
import { useAuiState } from '@assistant-ui/react';
import { useEffect, useState, type FC } from 'react';

import { DocumentPreview } from '@/components/features/document-preview';
import { flattenContext } from '@/components/features/project-page/context-panel';
import type { PreviewPayload } from '@/lib/document-preview';
import { useThreadProjectsOrNull } from '@/lib/thread-projects-sync';
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
  const fromTab = (tab.state ?? {}) as DocState;
  // 面板自己挑的那一份只活在这一次打开里 —— 不写回 tab.state,免得把
  // "用户明确在右侧打开的那份"覆盖掉。
  const [picked, setPicked] = useState<DocState | null>(null);
  const projectId = fromTab.projectId ?? picked?.projectId;
  const name = fromTab.name ?? picked?.name;
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

  // 没选文件时**把这个项目的文档摆出来**,而不是叫人去别处点一遍。
  // 刚生成的稿子明明就在上下文里,却要人绕回项目页 —— 那一句提示是把
  // 自己的活推给了用户(用户实测:"文档里也没有内容展示")。
  if (!projectId || !name) return <DocPicker onPick={setPicked} />;
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

/**
 * 还没选文件时的样子:**把当前项目的文档直接摆出来**。
 *
 * 从前这里只有一句"去项目的上下文清单里选一份文件,点「在右侧打开」" —— 刚生成
 * 的稿子明明就在上下文里,却要人绕回项目页再点一遍。面板知道自己属于哪个项目,
 * 那就自己去问。
 */
const DocPicker: FC<{ onPick: (doc: { projectId: string; name: string }) => void }> = ({ onPick }) => {
  const localThreadId = useAuiState((s) => s.threadListItem.id);
  const remoteThreadId = useAuiState((s) => s.threadListItem.remoteId ?? s.threadListItem.externalId);
  const threadId = remoteThreadId ?? localThreadId ?? undefined;
  const threadProjects = useThreadProjectsOrNull();
  const projectId = threadId ? threadProjects?.[threadId] : undefined;
  const [docs, setDocs] = useState<Array<{ name: string; detail: string }> | null>(null);

  useEffect(() => {
    if (!projectId) { setDocs([]); return; }
    let alive = true;
    void (async () => {
      const res = await fetch(
        `/api/project/context?projectId=${encodeURIComponent(projectId)}`,
      ).catch(() => null);
      const body = (await res?.json().catch(() => null)) as
        Parameters<typeof flattenContext>[0] | null;
      // **平铺,不按项目页那样把文件夹合成一张卡** —— 这里要选的就是具体某一份,
      // 分组会把文件夹里的文件整个吞掉(实测:项目明明有三份文件,这儿说"还没有文档")。
      if (alive) {
        setDocs(
          body
            ? flattenContext(body)
                .filter((i) => i.kind === 'file')
                .map((i) => ({ name: i.name, detail: i.detail }))
            : [],
        );
      }
    })();
    return () => { alive = false; };
  }, [projectId]);

  if (!projectId) {
    return (
      <p className="text-muted-foreground p-6 text-sm leading-relaxed">
        这条对话还没归到项目里。归进项目之后,项目里的文档会列在这儿。
      </p>
    );
  }
  if (docs === null) return <p className="text-muted-foreground p-6 text-sm">读取中…</p>;

  if (docs.length === 0) {
    return (
      <p className="text-muted-foreground p-6 text-sm leading-relaxed">
        这个项目还没有文档。给项目设一个文件夹,或者把文件拖进对话里。
      </p>
    );
  }

  return (
    <div className="h-full overflow-auto p-4">
      <p className="text-muted-foreground mb-2 text-xs">这个项目里的文档</p>
      <ul className="space-y-1">
        {docs.map((doc) => (
          <li key={doc.name}>
            <button
              type="button"
              onClick={() => onPick({ projectId, name: doc.name })}
              className="hover:bg-muted/50 flex w-full items-baseline gap-2 rounded px-2 py-1.5 text-left"
            >
              <span className="min-w-0 flex-1 truncate text-sm">{doc.name.replace(/^.*\//, '')}</span>
              <span className="text-muted-foreground shrink-0 text-[11px]">
                {doc.detail}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};
