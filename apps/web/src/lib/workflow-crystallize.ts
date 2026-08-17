/**
 * 把一段对话结晶成工作流 —— 前端这一半。
 *
 * 界面要回答的只有一个问题,而且要问得具体:**下次跑,这一项还一样吗?**
 * 用户不需要理解"结论 vs 步骤"这个区别 —— 那是我们的内部概念。
 */
export type DraftValue = { label: string; value: string; varies: boolean; why?: string };
export type Draft = {
  name: string;
  steps: Array<{ title: string; detail?: string }>;
  values: DraftValue[];
  findings: string[];
};

export async function crystallize(
  threadId: string,
  upTo: number | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; draft: Draft } | { ok: false; error: string }> {
  const res = await fetchImpl('/api/workflows/crystallize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ threadId, ...(upTo != null ? { upTo } : {}) }),
  });
  const body = (await res.json().catch(() => ({}))) as { draft?: Draft; message?: string };
  if (!res.ok || !body.draft) {
    return { ok: false, error: body.message ?? `结晶失败(HTTP ${res.status})` };
  }
  return { ok: true, draft: body.draft };
}

/**
 * 草案能不能存。
 *
 * **没有步骤就不能存** —— 一个零步的"工作流"跑起来什么也不做,但它会出现在列表里,
 * 让人以为这件事已经自动化了。
 */
export function draftBlocker(draft: Draft): string | null {
  if (!draft.name.trim()) return '给它起个名字';
  if (!draft.steps.length) return '至少要有一步 —— 没有步骤的工作流跑起来什么也不做';
  return null;
}

/** 确认页上那句话:这次要问几项。问得具体,不讲抽象概念。 */
export function describeDraft(draft: Draft): string {
  const varying = draft.values.filter((v) => v.varies).length;
  const fixed = draft.values.length - varying;
  const parts = [`${draft.steps.length} 步`];
  if (fixed) parts.push(`${fixed} 项固定`);
  if (varying) parts.push(`${varying} 项每次要确认`);
  if (draft.findings.length) {
    // 说清楚它被排除了 —— 人能看到我们没漏,而不是以为我们忘了。
    parts.push(`${draft.findings.length} 条结论不会带进去`);
  }
  return parts.join(' · ');
}

/** 切换某一项"下次还一样吗"。纯函数,便于测。 */
export function toggleVaries(draft: Draft, index: number): Draft {
  return {
    ...draft,
    values: draft.values.map((v, i) => (i === index ? { ...v, varies: !v.varies } : v)),
  };
}

/**
 * "从这条消息为止"换成服务端要的条数。
 *
 * **对不齐时返回 undefined(= 整段)**:客户端渲染的消息列表和服务端召回的
 * 那份不保证一一对应。用一个猜出来的下标去截,人看到的草案会缺掉他正要
 * 结晶的那几步 —— 而且看不出来是被截掉的。宁可多带。
 */
export function upToFromMessages(
  messages: ReadonlyArray<{ id: string }>,
  messageId: string,
): number | undefined {
  const i = messages.findIndex((m) => m.id === messageId);
  return i < 0 ? undefined : i + 1;
}
