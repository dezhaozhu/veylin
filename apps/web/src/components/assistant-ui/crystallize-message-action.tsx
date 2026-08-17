/**
 * 对话里的入口:**从这条消息为止,结晶成一个工作流**。
 *
 * 为什么是**每条消息上的动作**而不是顶上一个按钮:有用的通常是"我提出目标 →
 * 你给出做法"那一截,后面的追问和闲聊只会污染提炼。人指哪一条,就截到哪一条。
 *
 * 点了不会直接建 —— 先出草案让人认(见 crystallize-dialog)。从一次对话提炼的
 * 东西长在那次数据上,不认一遍就存,下次重放会拿旧结论当新答案。
 */
import { useCallback, useState, type FC } from 'react';

import { TooltipIconButton } from '@/components/assistant-ui/tooltip-icon-button';
import { CrystallizeDialog } from '@/components/features/project-page/crystallize-dialog';
import { crystallize, upToFromMessages, type Draft } from '@/lib/workflow-crystallize';
import { useAuiState } from '@assistant-ui/react';
import { WorkflowIcon } from 'lucide-react';

export const CrystallizeMessageAction: FC = () => {
  const threadId = useAuiState(
    (s) => s.threadListItem.remoteId ?? s.threadListItem.externalId ?? s.threadListItem.id,
  );
  const messageId = useAuiState((s) => s.message.id);
  const messages = useAuiState((s) => s.thread.messages);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (!threadId || busy) return;
    setBusy(true);
    setError(null);
    const out = await crystallize(
      threadId,
      upToFromMessages(messages as ReadonlyArray<{ id: string }>, messageId),
    );
    setBusy(false);
    // 服务端的原话直接给出来:"没东西可结晶"和"模型出错"不是一回事,
    // 统一成"失败了"会让人反复去点同一个按钮。
    if (out.ok) setDraft(out.draft);
    else setError(out.error);
  }, [busy, messageId, messages, threadId]);

  return (
    <>
      <TooltipIconButton tooltip={busy ? '正在提炼…' : '从这里结晶成工作流'} onClick={() => void run()}>
        <WorkflowIcon className={busy ? 'animate-pulse' : undefined} />
      </TooltipIconButton>
      {error ? <span className="text-destructive ms-1 text-xs">{error}</span> : null}
      {draft ? (
        <CrystallizeDialog
          draft={draft}
          onClose={() => setDraft(null)}
          onSave={async (d) => {
            // 节点图由服务端从草案生成 —— 前端不拼图。"结论不进提示词""会变的
            // 值不写成空占位符"这两条只该有一处实现,两处迟早对不上。
            const res = await fetch('/api/workflows/from-draft', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ threadId, draft: d }),
            });
            const body = (await res.json().catch(() => ({}))) as { message?: string };
            if (!res.ok) {
              setError(body.message ?? `保存失败(HTTP ${res.status})`);
              return;
            }
            setDraft(null);
          }}
        />
      ) : null}
    </>
  );
};
