/**
 * 表格变更日志 —— 把"人在表格里改了什么"推进聊天上下文。
 *
 * **为什么需要它**:agent 靠重新读表只能看到**新值**,看不到"改过"、看不到从什么改成
 * 什么、更看不到是人改的还是排产改的。引用(拉)解决"你在看什么",变更(推)解决"发生
 * 过什么" —— 少了后者,agent 会把人的决策当成系统状态,还会重复建议已经被否掉的方案。
 *
 * **刻意做成进程内、有上限、不落库**:它是**上下文**不是状态。真正的状态在治理车道
 * (草稿/提案/提交)里,那才是权威。这里只负责让本轮对话知道刚才发生了什么;服务重启
 * 后丢失是可接受的,注入时也不会假装它是完整历史。
 */
export type TableEdit = {
  sheet: string;
  rowKey: string;
  column: string;
  from: unknown;
  to: unknown;
  by: 'human' | 'agent';
  at: string;
};

/** 每个会话最多留这么多条:长会话不能无界增长,注入的块也不能挤爆上下文。 */
export const MAX_EDITS_PER_THREAD = 50;

const journal = new Map<string, TableEdit[]>();

export function recordTableEdits(input: {
  threadId: string | null | undefined;
  sheet: string;
  by: 'human' | 'agent';
  edits: Array<{ rowKey: string; column: string; from: unknown; to: unknown }>;
}): void {
  const threadId = (input.threadId ?? '').trim();
  if (!threadId) return;                       // 无会话上下文的编辑(工作区面板)无处可注入
  const at = new Date().toISOString();
  const list = journal.get(threadId) ?? [];
  for (const e of input.edits) {
    // 值没变就不是变更 —— 记它只会稀释真正的信号。
    if (String(e.from ?? '') === String(e.to ?? '')) continue;
    list.push({ sheet: input.sheet, rowKey: e.rowKey, column: e.column,
                from: e.from, to: e.to, by: input.by, at });
  }
  journal.set(threadId, list.slice(-MAX_EDITS_PER_THREAD));
}

export function recentTableEdits(threadId: string | null | undefined): TableEdit[] {
  return journal.get((threadId ?? '').trim()) ?? [];
}

export function clearTableEdits(): void {
  journal.clear();
}

/** 注入聊天上下文的块。没有变更就返回空串(什么都不注入)。 */
export function formatTableEditsBlock(threadId: string | null | undefined): string {
  const edits = recentTableEdits(threadId);
  if (edits.length === 0) return '';
  const lines = [
    '# 表格变更(本会话)',
    '以下是**本轮对话期间表格里发生的修改**。重新读表只能看到新值,看不到改过 —— 所以',
    '在这里给你。用户改过的值代表**他的决定**,不要建议改回去,也不要当成系统算出来的。',
  ];
  for (const e of edits) {
    const who = e.by === 'human' ? '用户' : 'agent';
    lines.push(
      `- ${who}把 \`${e.sheet}\` 的 \`${e.rowKey}\` 的「${e.column}」`
      + `从 ${String(e.from ?? '（空）')} → ${String(e.to ?? '（空）')}`,
    );
  }
  return lines.join('\n');
}
