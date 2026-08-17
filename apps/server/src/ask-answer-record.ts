/**
 * 把用户对 ask_user_question 的回答**写回历史**。
 *
 * 缺口是实测出来的:`resume.resumeData` 直接进 `resumeStream`,从来不落库。于是历史
 * 里那个工具调用**永远是"未回答"的样子**,而事实是答过了 —— 后面每一轮 agent 都
 * 不知道用户当时选了什么,只能重新问。
 *
 * 写进**那个部件本身**,不另起一条消息:答案是这次调用的结果,不是一句新发言。
 */
type MessageLike = { id?: string; role: string; parts?: unknown[] };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v != null;

export function recordAskAnswer<T extends MessageLike>(
  messages: T[],
  toolCallId: string,
  answer: unknown,
): T[] {
  if (!toolCallId) return messages;
  let touched = false;

  const out = messages.map((m) => {
    if (m.role !== 'assistant' || !Array.isArray(m.parts)) return m;
    if (!m.parts.some((p) => isRecord(p) && p.toolCallId === toolCallId)) return m;

    const parts = m.parts
      // 挂起标记记的是"还在等",现在不等了 —— 留着它,后面的 strip 还会把这条
      // 当成悬空调用摘掉,等于白写。
      .filter((p) => !(isRecord(p) && p.type === 'data-tool-call-suspended'
        && isRecord(p.data) && p.data.toolCallId === toolCallId))
      .map((p) => {
        if (!isRecord(p) || p.toolCallId !== toolCallId) return p;
        // **已经有结果的不覆盖**:重复 resume 不该改掉先前的答案。
        if (p.state === 'output-available') return p;
        touched = true;
        return { ...p, state: 'output-available', output: answer };
      });
    return { ...m, parts };
  });

  // 一个都没对上就原样返回 —— 不瞎写,也不让调用方白白重写一遍整条线程。
  return touched ? out : messages;
}

/**
 * 把答案落库。
 *
 * 刀口用 `updateMessages` 而不是"整条线程删了重存"(replaceThreadMessages 那条路):
 * 只碰那一条、保住原始 createdAt,万一失败也不会把整段历史带走。
 *
 * **失败一律吞掉**:答案没写进历史是遗憾,resume 因此答不上话是事故。
 */
type MemoryLike = {
  recall: (args: { threadId: string; resourceId: string; perPage: false }) => Promise<{
    messages?: Array<{ id?: string; role?: string; content?: unknown }>;
  }>;
  updateMessages: (args: {
    messages: Array<{ id: string; content: unknown }>;
  }) => Promise<unknown>;
};

export async function persistAskAnswer(
  memory: MemoryLike,
  identity: { threadId: string; resourceId: string },
  toolCallId: string,
  answer: unknown,
): Promise<void> {
  try {
    const recalled = await memory.recall({
      threadId: identity.threadId,
      resourceId: identity.resourceId,
      perPage: false,
    });
    const stored = recalled.messages ?? [];
    const view = stored.map((m) => ({
      id: m.id,
      role: m.role ?? '',
      parts: (m.content as { parts?: unknown[] } | undefined)?.parts,
    }));
    const patched = recordAskAnswer(view, toolCallId, answer);
    if (patched === view) return; // 没什么可改 —— 一次写都不发。

    // 按下标比对:recordAskAnswer 原样返回没动过的那些,`!==` 就是"这条被改了"。
    const changed = patched.flatMap((p, i) => {
      if (p === view[i] || !p.id) return [];
      return [{ id: p.id, content: { ...(stored[i]!.content as object), parts: p.parts } }];
    });
    if (changed.length > 0) await memory.updateMessages({ messages: changed });
  } catch {
    // 见上:落库失败不该把这次 resume 弄挂。
  }
}
