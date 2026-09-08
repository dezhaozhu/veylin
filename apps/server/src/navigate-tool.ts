import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/**
 * 排产即导航 · agent 的入口。
 *
 * 卡片点条走的是 widget → postMessage(navigate) → 宿主;这个工具让模型也能说
 * 「打开甘特定位到这道作业」并真的做到 —— 服务端只做校验+回显,**真正的动作在
 * 客户端**(NavigateToolUI 拿到结果后调同一个 useNavigateAnchor,和卡片点条是
 * 同一个 handler、两个入口)。所以它不改任何数据,也不读任何数据。
 *
 * `issued_at` 是给客户端的重放闸:回看旧对话时同一条工具结果会再渲染一次,
 * 不能每次都把右栏拉开 —— 只有刚发出的结果才触发导航。
 */
const VIEWS = ['resource', 'workshop', 'order'] as const;
const KINDS = ['job', 'order', 'view', 'resource'] as const;
const SURFACES = ['gantt', 'grid'] as const;

export const navigateAnchorSchema = z.object({
  kind: z.enum(KINDS),
  id: z.string().min(1).max(200),
  order_id: z.string().min(1).max(200).optional(),
  at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}/)
    .optional()
    .describe('开工日 YYYY-MM-DD。甘特默认窗口对不上这一行时,用它把时间窗挪过去。'),
  run_id: z.string().min(1).max(200).optional().describe('你看到这个位置时的排产运行 id(工具结果里的 run_id/meta.run_id);落地面拿它比版本'),
});

export type NavigateAnchor = z.infer<typeof navigateAnchorSchema>;

export function buildNavigateTools() {
  const navigate = createTool({
    id: 'navigate',
    description:
      '把右侧面板带到排产里的某个位置(排产即导航),不改任何数据。' +
      'anchor 只带 Compass 自己的身份:kind=job 时 id 是作业号(job_id,可附 order_id 与开工日 at);' +
      'kind=order 时 id 是订单号;kind=view 时 id 是甘特视角(resource|workshop|order);' +
      'kind=resource 时 id 是资源**编码**(如 JG0505-1,驾驶舱/产能证据里的 resource 字段),甘特翻到含它那条泳道并高亮,' +
      '它不在排产模型的泳道里时面板会如实说明(三级工作中心在二级模型里常常没有泳道)。' +
      'surface 是建议去哪个面板(gantt|grid),默认 gantt;用户没装甘特时宿主会退到排产表定位同一道作业。' +
      '定位是否成功由面板自己如实显示:当前窗口里找不到时它不会乱滚到别的行。' +
      '适合在回答里说完「瓶颈在 X / 这道作业迟了」之后,带用户去看那一处。',
    inputSchema: z.object({
      kind: z.enum(KINDS),
      id: z.string().min(1).max(200),
      order_id: z.string().min(1).max(200).optional(),
      at: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
      run_id: z.string().min(1).max(200).optional(),
      surface: z.enum(SURFACES).optional(),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      error: z.string().optional(),
      anchor: navigateAnchorSchema.optional(),
      surface: z.enum(SURFACES).optional(),
      /** 发出时刻(ms)。客户端只对刚发出的结果动作,回看旧对话不再触发。 */
      issued_at: z.number().optional(),
    }),
    execute: async (input) => {
      if (input.kind === 'view' && !(VIEWS as readonly string[]).includes(input.id)) {
        return { ok: false, error: `kind=view 时 id 只能是 ${VIEWS.join('|')},收到 ${input.id}` };
      }
      const anchor: NavigateAnchor = { kind: input.kind, id: input.id };
      if (input.order_id) anchor.order_id = input.order_id;
      if (input.at) anchor.at = input.at.slice(0, 10);
      if (input.run_id) anchor.run_id = input.run_id;
      return { ok: true, anchor, surface: input.surface ?? 'gantt', issued_at: Date.now() };
    },
  });

  return { navigate };
}
