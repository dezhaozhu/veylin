/**
 * `document_edit` 的结果:**红绿对照 + 一键撤销**。
 *
 * 为什么不是"改之前先问":按定下的治理模型,安全网是**版本 + 回退**,不是每一步
 * 都设闸。所以这里的姿态是"已经改了,你看一眼,不对就退" —— 而不是拦住人问
 * "要不要改"(那样每改一句话都要点一次同意,没人受得了)。
 *
 * 三句话必须都在:改了哪一版 / **原件没动** / 能撤销。少了中间那句,人会以为
 * 我们动了他那份 docx。
 */
import { useState, type FC } from 'react';

import {
  describeEdit,
  diffLines,
  undoTarget,
} from '@/lib/document-edit-result';

type EditResult = {
  ok?: boolean;
  copy?: string;
  revision?: number;
  diff?: string;
  note?: string;
  error?: string;
  created_copy?: boolean;
};

export const DocumentEditResult: FC<{ result: EditResult; projectId?: string; name?: string }> = ({
  result,
  projectId,
  name,
}) => {
  const [undone, setUndone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  if (!result.ok) {
    // 拒绝要原样显示 —— "这段原文有 2 处"正是人需要看到的下一步。
    return (
      <div className="border-border bg-muted/30 rounded-lg border px-3 py-2 text-xs leading-relaxed">
        <span className="text-muted-foreground">没有改动 · </span>
        {result.error ?? '这次修改没有生效'}
      </div>
    );
  }

  const lines = diffLines(result.diff);
  const target = undoTarget(result.revision ?? 0);

  return (
    <div className="border-border overflow-hidden rounded-lg border text-xs">
      <div className="bg-muted/40 flex items-center justify-between gap-3 px-3 py-1.5">
        <span className="text-muted-foreground min-w-0 truncate">
          {describeEdit({
            copy: result.copy ?? '副本',
            revision: result.revision ?? 1,
            ...(result.created_copy ? { created: true } : {}),
          })}
        </span>
        {target && projectId && name && !undone ? (
          <button
            type="button"
            disabled={busy}
            className="hover:bg-background shrink-0 rounded border px-2 py-0.5 disabled:opacity-40"
            onClick={async () => {
              setBusy(true);
              const res = await fetch('/api/project/document/rollback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId, name, to: target }),
              });
              const body = (await res.json().catch(() => ({}))) as { error?: string };
              setBusy(false);
              // 撤销失败要说出来 —— 按钮变灰而文档没变,是最坏的一种"看起来成了"。
              if (res.ok) setUndone(true);
              else setFailed(body.error ?? `撤销失败(HTTP ${res.status})`);
            }}
          >
            {busy ? '撤销中…' : '撤销这次修改'}
          </button>
        ) : null}
        {undone ? <span className="text-muted-foreground shrink-0">已撤销</span> : null}
      </div>

      <div className="divide-border/60 divide-y font-mono">
        {lines.map((l, i) => (
          <div
            key={i}
            className={
              l.kind === 'add'
                ? 'bg-emerald-500/10 px-3 py-1'
                : l.kind === 'del'
                  ? 'bg-red-500/10 px-3 py-1 line-through decoration-red-500/40'
                  : 'text-muted-foreground px-3 py-1'
            }
          >
            <span className="text-muted-foreground mr-2 select-none">
              {l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}
            </span>
            {l.text}
          </div>
        ))}
      </div>

      {failed ? <p className="text-destructive px-3 py-1.5">{failed}</p> : null}
    </div>
  );
};
