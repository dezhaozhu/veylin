/**
 * 上下文全景面板:搜索 + 清单 + 预览。
 *
 * 侧栏那一段只回答"有多少、大致是什么";真要找一份东西、或者想看看里面写了什么,
 * 侧栏太窄。这一层是为那两件事存在的。
 *
 * 三条:
 * - **搜索是过滤已经在这儿的东西**,不是再查一遍后端 —— 这一栏本来就是全量。
 * - **预览是只读的**,而且表格类只给概览:要筛选统计得导入后用表格工具,那才是能
 *   回答问题的形状;把几万行塞进预览面板既慢又没人读。
 * - **连接器不给预览**:它不是一个文件,是一条会变的线。硬给一个"内容"面板,
 *   等于把"此刻取到的一份快照"讲成了"它的内容"。
 */
import { useEffect, useState, type FC } from 'react';

import { DocumentPreview } from '@/components/features/document-preview';
import { describeFreshness } from '@/lib/freshness';
import type { PreviewPayload } from '@/lib/document-preview';

export type ContextItem =
  | { kind: 'file'; name: string; detail: string }
  | { kind: 'connector'; name: string; detail: string };

type Preview =
  | { state: 'idle' }
  | { state: 'loading' }
  /** 读到了 —— 怎么显示(图/版式/文字/文件卡)由 DocumentPreview 决定 */
  | { state: 'ready'; payload: PreviewPayload }
  /** 压根不该去读(连接器)、或读失败 */
  | { state: 'note'; payload: PreviewPayload };

export const ContextPanel: FC<{
  items: ContextItem[];
  projectId: string;
  onClose: () => void;
}> = ({ items, projectId, onClose }) => {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<ContextItem | null>(null);
  const [preview, setPreview] = useState<Preview>({ state: 'idle' });

  const kw = q.trim().toLowerCase();
  const shown = items.filter(
    (i) => !kw || i.name.toLowerCase().includes(kw) || i.detail.toLowerCase().includes(kw),
  );

  useEffect(() => {
    if (!picked) { setPreview({ state: 'idle' }); return; }
    if (picked.kind === 'connector') {
      setPreview({
        state: 'note',
        payload: {
          note: '这是一条数据源连接,不是一个文件 —— 它的内容随时会变。要看具体的行,在对话里问,或者用表格工具筛。',
        },
      });
      return;
    }
    let alive = true;
    setPreview({ state: 'loading' });
    void (async () => {
      try {
        const res = await fetch(
          `/api/project/file?projectId=${encodeURIComponent(projectId)}&name=${encodeURIComponent(picked.name)}`,
        );
        const body = (await res.json()) as PreviewPayload & { ok?: boolean; error?: string };
        if (!alive) return;
        if (!res.ok || body.error) {
          setPreview({ state: 'note', payload: { note: body.error ?? '读不到这个文件' } });
          return;
        }
        // 缩略图 / 带版式的 HTML 一并交给 DocumentPreview —— 从前这里只取 text,
        // 于是一份 xlsx(只有结构化字段、没有 text)永远显示成"没有可预览的
        // 文本内容",而我们其实读到了。
        setPreview({ state: 'ready', payload: body });
      } catch (err) {
        if (alive) {
          setPreview({ state: 'note', payload: { note: err instanceof Error ? err.message : String(err) } });
        }
      }
    })();
    return () => { alive = false; };
  }, [picked, projectId]);

  return (
    <div className="bg-background/70 fixed inset-0 z-50 flex items-center justify-center p-6 backdrop-blur-sm">
      <div className="border-border bg-card flex h-[80vh] w-full max-w-5xl flex-col rounded-xl border shadow-lg">
        <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
          <div>
            <h2 className="text-lg font-semibold">上下文</h2>
            <p className="text-muted-foreground text-xs">{items.length} 项</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground rounded px-2 text-lg leading-none"
            aria-label="关闭"
          >
            ×
          </button>
        </header>

        <div className="flex min-h-0 flex-1 gap-4 px-5 pb-5">
          <div className="flex w-64 shrink-0 flex-col">
            <input
              className="border-input mb-2 h-8 rounded-md border px-2 text-sm"
              placeholder="搜索…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
              {shown.map((i) => (
                <li key={`${i.kind}-${i.name}`}>
                  <button
                    type="button"
                    onClick={() => setPicked(i)}
                    className={`w-full truncate rounded px-2 py-1.5 text-left text-sm ${
                      picked?.name === i.name ? 'bg-muted text-foreground' : 'hover:bg-muted/60'
                    }`}
                    title={`${i.name} · ${i.detail}`}
                  >
                    {i.name}
                  </button>
                </li>
              ))}
              {/* 搜不到要说一声 —— 空白会被读成"这儿本来就没东西"。 */}
              {shown.length === 0 ? (
                <li className="text-muted-foreground px-2 py-2 text-xs">
                  {kw ? `没有匹配「${q}」的项` : '这个项目还没有上下文'}
                </li>
              ) : null}
            </ul>
          </div>

          <div className="bg-muted/30 min-w-0 flex-1 overflow-auto rounded-lg p-4">
            {preview.state === 'idle' ? (
              <p className="text-muted-foreground flex h-full items-center justify-center text-sm">
                选一个看看里面是什么。
              </p>
            ) : null}
            {preview.state === 'loading' ? (
              <p className="text-muted-foreground text-sm">读取中…</p>
            ) : null}
            {picked && (preview.state === 'ready' || preview.state === 'note') ? (
              <DocumentPreview
                name={picked.name}
                payload={preview.payload}
                action={
                  picked.kind === 'file' ? (
                    // 打不开也走得下去:文件本来就躺在项目文件夹里,让人去拿。
                    <button
                      type="button"
                      className="text-foreground text-xs underline underline-offset-4"
                      onClick={() => {
                        void fetch('/api/project/reveal', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ path: picked.name }),
                        });
                      }}
                    >
                      在访达中显示
                    </button>
                  ) : null
                }
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};

/** 侧栏的三类东西摊平成一张清单(顺序=文件在前,连接器在后:文件不变,连接器会腐烂)。 */
export function flattenContext(data: {
  originals: Array<{ name: string; bytes: number; seenCount: number }>;
  snapshots: Array<{ name: string; bytes: number; at: string }>;
  connectors: Array<{ server: string; tenant?: string; oldestLoadedAt: string; sheets: string[] }>;
}): ContextItem[] {
  const kb = (n: number) =>
    n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
  return [
    ...data.originals.map((f) => ({
      kind: 'file' as const,
      name: f.name,
      detail: `原件 · ${kb(f.bytes)}${f.seenCount > 1 ? ` · 用过 ${f.seenCount} 次` : ''}`,
    })),
    ...data.snapshots.map((f) => ({
      kind: 'file' as const, name: f.name, detail: `快照 · ${kb(f.bytes)}`,
    })),
    ...data.connectors.map((c) => ({
      kind: 'connector' as const,
      name: c.tenant ?? c.server,
      detail: `${c.sheets.join('、')} · ${describeFreshness(c.oldestLoadedAt)}`,
    })),
  ];
}
