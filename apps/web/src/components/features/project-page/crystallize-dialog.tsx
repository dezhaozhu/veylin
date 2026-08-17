/**
 * 对话结晶成工作流的确认页。
 *
 * **草案先给人看,不直接存** —— 从一次对话提炼的东西长在那次数据上:
 * "金工分厂是瓶颈"是结论不是步骤,当成步骤写进去,换个时间重放照样跑出结果,
 * 看起来在工作但答案是错的。
 *
 * 界面只问一个具体问题:**下次跑,这一项还一样吗?** 用户不需要理解
 * "结论 vs 步骤" —— 那是我们的内部概念。LLM 先给建议,人只做否决。
 *
 * 结论单独一栏、默认不带进去,**摆在眼前但不生效** —— 比藏起来安全:
 * 人能看到它被排除了,而不是以为我们漏了。
 */
import { useState, type FC } from 'react';

import {
  describeDraft,
  draftBlocker,
  toggleVaries,
  type Draft,
} from '@/lib/workflow-crystallize';

export const CrystallizeDialog: FC<{
  draft: Draft;
  onSave: (draft: Draft) => void | Promise<void>;
  onClose: () => void;
}> = ({ draft: initial, onSave, onClose }) => {
  const [draft, setDraft] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const blocker = draftBlocker(draft);

  return (
    <div className="bg-background/70 fixed inset-0 z-50 flex items-center justify-center p-6 backdrop-blur-sm">
      <div className="border-border bg-card flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border shadow-lg">
        <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-2">
          <div className="min-w-0">
            <input
              className="border-input w-full rounded border px-2 py-1 text-base font-medium"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <p className="text-muted-foreground mt-1 text-xs">{describeDraft(draft)}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground px-2 text-lg leading-none">×</button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-3 text-sm">
          <section>
            <h3 className="text-muted-foreground mb-1 text-xs">步骤</h3>
            <ol className="list-decimal space-y-1 pl-5">
              {draft.steps.map((s, i) => (
                <li key={i}>
                  {s.title}
                  {s.detail ? <span className="text-muted-foreground"> —— {s.detail}</span> : null}
                </li>
              ))}
            </ol>
          </section>

          {draft.values.length ? (
            <section>
              <h3 className="text-muted-foreground mb-1 text-xs">这次用的值 · 下次还一样吗</h3>
              <ul className="space-y-1.5">
                {draft.values.map((v, i) => (
                  <li key={v.label} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">
                      {v.label} = <span className="text-muted-foreground">{v.value}</span>
                    </span>
                    <button
                      className="hover:bg-muted shrink-0 rounded border px-2 py-0.5 text-xs"
                      title={v.why ?? ''}
                      onClick={() => setDraft(toggleVaries(draft, i))}
                    >
                      {v.varies ? '每次不同' : '一样'}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {draft.findings.length ? (
            <section className="bg-muted/40 rounded-lg px-3 py-2">
              <h3 className="text-muted-foreground mb-1 text-xs">
                这次得出的结论 · 不会带进工作流
              </h3>
              <ul className="text-muted-foreground list-disc space-y-0.5 pl-5 text-xs">
                {draft.findings.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
              <p className="text-muted-foreground mt-1 text-xs">
                它们是这次的答案,不是下次该得出的答案 —— 只会作为例子写进说明。
              </p>
            </section>
          ) : null}
        </div>

        <footer className="border-border flex items-center justify-between gap-3 border-t px-5 py-3">
          <span className="text-destructive text-xs">{blocker ?? ''}</span>
          <div className="flex gap-2">
            <button className="hover:bg-muted rounded-md border px-3 py-1 text-sm" onClick={onClose}>取消</button>
            <button
              className="bg-foreground text-background rounded-md px-3 py-1 text-sm disabled:opacity-40"
              disabled={!!blocker || busy}
              onClick={async () => { setBusy(true); await onSave(draft); setBusy(false); }}
            >
              {busy ? '保存中…' : '保存为工作流'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};
