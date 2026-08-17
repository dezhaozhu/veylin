/**
 * 把一段对话结晶成工作流草案。
 *
 * **不直接生成能跑的工作流,只生成草案** —— 因为从一次对话里提炼出的东西,是长在
 * 那次对话的数据上的。上重那次分析里"金工分厂是瓶颈"是**结论**,不是步骤;当成
 * 步骤写进去,换个时间重放会照样跑出结果 —— 看起来在工作,但答案是错的。
 *
 * 所以草案按三样分开(业内叫 dialog workflow extraction,值那一栏就是 slots):
 *
 * - **steps** 可复用的动作
 * - **values** 这次用的具体值,每项带一个"下次还一样吗"的判断
 * - **findings** 这次得到的结论 —— **默认不进工作流**,只作为例子附在说明里。
 *   摆在眼前但不生效,比藏起来更安全:人能看到它被排除了,而不是以为我们漏了。
 *
 * 用户不需要理解"结论 vs 步骤"这个抽象区别 —— 那是我们的内部概念。他只回答一个
 * 具体问题:**下次跑,这一项还一样吗?**
 *
 * 场景那一层不问:工作流归属项目,项目已经绑好了场景(上重就是上重)。
 */
import { z } from 'zod';

export const crystallizedDraftSchema = z.object({
  name: z.string().min(1),
  /** 可复用的动作,按顺序。 */
  steps: z.array(z.object({
    title: z.string().min(1),
    detail: z.string().optional(),
  })).min(1),
  /** 这次用到的具体值。`varies` = LLM 的建议,人可以改。 */
  values: z.array(z.object({
    label: z.string().min(1),
    value: z.string(),
    varies: z.boolean(),
    /** 为什么judged成会变/不变 —— 人要否决时得知道它在想什么。 */
    why: z.string().optional(),
  })).default([]),
  /** 这次的结论。**默认不进工作流**。 */
  findings: z.array(z.string()).default([]),
});

export type CrystallizedDraft = z.infer<typeof crystallizedDraftSchema>;

export const CRYSTALLIZE_SYSTEM_PROMPT = [
  '你要把一段对话结晶成一个可复用的工作流草案。只输出 JSON。',
  '',
  '把内容分成三类,不要混:',
  '1. steps —— 换一批数据也照样成立的**动作**(查什么、比什么、按什么顺序)。',
  '2. values —— 这次用到的**具体值**(资源名、订单号、时间窗…)。每项判断',
  '   varies:下次跑还会是同一个值吗?拿不准就填 true —— 把一个其实不变的值',
  '   标成会变,代价只是多问一次;反过来会让工作流悄悄锁死在这次的数据上。',
  '3. findings —— 这次**得出的结论**(哪个是瓶颈、超了多少)。它们不是步骤。',
  '   不要把结论写进 steps。',
  '',
  '注意:租户/工厂/场景**不要**放进 values —— 工作流归属项目,场景是继承的。',
  '',
  'JSON 形状: {"name":"…","steps":[{"title":"…","detail":"…"}],',
  '"values":[{"label":"…","value":"…","varies":true,"why":"…"}],"findings":["…"]}',
].join('\n');

/** 把对话消息拼成给模型的输入。只取文本,截断过长的单条 —— 一条几万字的工具输出
 *  会把真正的意图挤出窗口。 */
export function conversationToPrompt(
  messages: Array<{ role: string; content: string }>,
  maxPerMessage = 2000,
): string {
  return messages
    .filter((m) => m.content?.trim())
    .map((m) => {
      const body = m.content.length > maxPerMessage
        ? m.content.slice(0, maxPerMessage) + `…(截断,原长 ${m.content.length})`
        : m.content;
      return `[${m.role}] ${body}`;
    })
    .join('\n\n');
}

/**
 * 草案 → 可存的工作流定义所需的信息。
 *
 * **findings 不进步骤**,只作为说明里的一段"上次跑出来的样子",而且明确标注它属于
 * 哪一次 —— 否则下次的人会把它读成"这个工作流应该得出的结论"。
 */
export function draftToWorkflowInput(draft: CrystallizedDraft): {
  name: string;
  description: string;
  steps: string[];
} {
  const varying = draft.values.filter((v) => v.varies);
  const fixed = draft.values.filter((v) => !v.varies);
  const lines: string[] = [];
  if (fixed.length) {
    lines.push('固定参数:' + fixed.map((v) => `${v.label}=${v.value}`).join('、'));
  }
  if (varying.length) {
    lines.push('每次要确认:' + varying.map((v) => v.label).join('、'));
  }
  if (draft.findings.length) {
    lines.push(
      '上次跑出来的结论(仅供参考,不是这个工作流应该得出的答案):' +
      draft.findings.join(';'),
    );
  }
  return {
    name: draft.name,
    description: lines.join('\n'),
    steps: draft.steps.map((s) => (s.detail ? `${s.title} —— ${s.detail}` : s.title)),
  };
}
