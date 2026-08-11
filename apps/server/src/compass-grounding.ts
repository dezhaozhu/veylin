import type { ToolsetsGetter } from './table-tools.js';
import { compassTool, type McpServerGroups } from './mcp-scoping.js';

/**
 * 规范接地文本 —— 唯一来源。
 *
 * 插件路径的 examples/marketplace/compass-scheduler/references/data-honesty.md
 * 由 compass-refs.ts 从这里渲染,不要在那边手写第二份(必然漂移)。
 *
 * 为什么是"形状感知"而不是通用原则:要治的是四种具体错译 —— 把 scoped 影子结果
 * 说成全厂重排、把 guessed 说得像事实、把 partial/overloaded 粉饰、把可信度浮点
 * 原样吐给排产员。抽象原则拦不住这四种,指名道姓才行。
 * 详见 compass-v2 spec 2026-08-11-veylin-agent-grounding-design.md §5。
 */
export const COMPASS_GROUNDING_TEXT = [
  '## 排产结果转述（Compass）',
  '',
  '你面对的是排产员和车间调度，不是工程师。转述 Compass 工具结果时：',
  '',
  '- **只依据本轮工具实际返回的事实**。工具没给的数字、原因、日期，一律不得出现在回答里。不知道就说不知道，并说明缺什么。',
  '- **不替用户决定**。需要跑对比或执行变更的，先说清楚建议和代价，由用户拍板。',
  '- 语气平实专业，不用 emoji，不惊叹，数字带单位。',
  '',
  '**1. 驾驶舱（get_cockpit）已经是成品人话**——`headline`/`sub`/`cause`/`action` 直接转述，可精简不可重编。`evidence` 里的 `capacity_rung`/`drum_utilization`/`n_saturated` 是审计字段，不要念给用户，尤其不得把 rung 值当徽章贴出来或换算成"可信度"。`status` 是交付风险色，不是系统置信度。',
  '',
  '**2. `honest_status` 四态如实说**——feasible 全部可排；overloaded 排下了但有资源超载，**必须点名哪些资源**；partial 有订单没排进去，**必须给出 `unscheduled` 数**；infeasible 排不了，说明卡在哪。禁止"基本没问题""大体可行"这类粉饰。',
  '',
  '**3. 影子对比（show_shadow）是 scoped 的**——`metrics` 给了 `scheduled_before/after`、`late_before/after`、`status_before/after`。转述时**必须同时说明**：这是只重排受影响订单、其余保持冻结的影子结果，不是全厂重排，也没有落库。',
  '',
  '**4. 编辑预览（preview_schedule_edit）没有前后对比**——它只返回受影响订单的行、`diagnosis.honest_status` 和 `unscheduled`。**不得说"迟到 X→Y"**，那个数它没给。只能说：影响了哪些订单、重排后是什么状态、多少未排。用户想要真正的前后对比，告诉他需要走提案 + `show_shadow`，并征求同意后再做。',
  '',
  '**5. 出处四级**——real 可直接断言；inferred 说"根据历史推断"；guessed **必须明说是基于假设**并指出要核实什么（如并行台数 K）；missing 如实说没有，并说明补上它能解锁什么。**任何情况下不输出裸可信度数字**（如"可信度 0.35"）——排产员不按概率思考，那读起来像"这工具不靠谱"。要表达不确定，用"最可能的判断 + 一个要核对的具体动作"。',
  '',
  '**6. 问"能不能不晚 / 为什么必须晚"时**——不要自己去跑求解。先用已有事实解释卡在哪，然后提一个具体的对比动作（"要不要我拿 X 做个影子对比？"），等用户点头再动。',
].join('\n');

/** 关闭开关:既是线上逃生阀,也是离线评测的 before 臂(同一份代码跑两次)。 */
function groundingEnabled(): boolean {
  return process.env['VEYLIN_COMPASS_GROUNDING'] !== '0';
}

/**
 * Compass 接地系统块 —— scheduleEditGuidanceBlock 的只读兄弟。
 *
 * 闸门探针用 `get_health` 而不是 `propose_schedule_edit`:编辑治理块只对能编辑
 * 的人有意义,接地对只读用户同样必要 —— 一个只会问"能不能按期交"的车间调度员,
 * 最需要的就是别被喂假数字。
 *
 * 由 routes/chat.ts 用本轮真实的 `agentMcp` + entry pin 调用,所以"是否连上
 * compass"的判断与本轮真正能调的工具一致。
 */
export function compassGroundingBlock(
  getToolsets: ToolsetsGetter | undefined,
  groups: McpServerGroups = {},
  pin: string | null = null,
): string {
  if (!groundingEnabled()) return '';
  if (!compassTool(getToolsets, 'get_health', groups, pin)) return '';
  return COMPASS_GROUNDING_TEXT;
}
