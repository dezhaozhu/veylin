/**
 * 工具结果的「模型视图」:模型看摘要,卡片/面板看全量。
 *
 * 为什么要它(2026-09-08 真跑踩出来的):Compass `get_gantt` 一次回 1,500 根条
 * ≈ 366KB JSON ≈ 13 万 token。mastra 的 MCP 客户端把 structuredContent 原样当
 * 工具输出,于是同一份东西既给了卡片(该给)也进了模型上下文(不该给)——DeepSeek
 * 128k 直接 ContextWindowExceeded,那一轮就静默死掉;Qwen 能吞但一轮 53 秒。
 * 症状是「assistant 只剩 step-start」,和模型下线长得一模一样,查了一圈才分开。
 *
 * 做法:AI SDK 的 `toModelOutput` 正是为这个缝设计的 —— 工具输出照旧存进历史、
 * 照旧给客户端 part,只有**递给模型的那一份**换成压缩视图。压缩规则通用、诚实:
 *  · 小于阈值原样给;
 *  · 超过阈值时把每个数组截到前 K 条,K 从 12 往下试到 1,直到装得下;
 *  · 被截的数组最后一项写明「…还有 N 条未给模型」,并在顶层挂 `_model_view`
 *    说明完整数据在卡片/面板里 —— 模型知道自己看的是节选,不会把 20 条当全部。
 * 不按工具名特判:今天是甘特,明天是别的大结果。
 */
export const MODEL_VIEW_LIMIT_CHARS = 24_000;
const K_LADDER = [12, 4, 1] as const;

export type ModelViewNote = {
  truncated: true;
  arrays_cut: number;
  items_hidden: number;
  note: string;
};

type Stats = { arraysCut: number; itemsHidden: number };

/** 容器数组(元素自己还装着数组,如甘特的 lanes)留得宽些:砍叶子(bars)比砍泳道
 * 损失小 —— 20 条泳道各留 4 根,比 4 条泳道各留 12 根更像那张图。 */
const CONTAINER_K = 24;

function isContainerArray(value: unknown[]): boolean {
  const probe = value[0];
  return !!probe && typeof probe === 'object' && !Array.isArray(probe)
    && Object.values(probe as Record<string, unknown>).some((v) => Array.isArray(v));
}

function cut(value: unknown, k: number, stats: Stats, depth: number): unknown {
  if (depth > 12) return value;
  if (Array.isArray(value)) {
    const keep = isContainerArray(value) ? Math.max(k, CONTAINER_K) : k;
    if (value.length <= keep) return value.map((v) => cut(v, k, stats, depth + 1));
    stats.arraysCut += 1;
    stats.itemsHidden += value.length - keep;
    return [
      ...value.slice(0, keep).map((v) => cut(v, k, stats, depth + 1)),
      `…还有 ${value.length - keep} 条未给模型(完整数据在卡片/面板里)`,
    ];
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) out[key] = cut(v, k, stats, depth + 1);
    return out;
  }
  if (typeof value === 'string' && value.length > 2_000) {
    stats.itemsHidden += 1;
    return `${value.slice(0, 2_000)}…(截断,原长 ${value.length} 字符)`;
  }
  return value;
}

function size(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * 给模型看的那一份。阈值内原样返回(同一引用,零开销);超了返回压缩副本。
 * 返回值仍是可 JSON 化的普通值,直接当 `{type:'json', value}` 递给 AI SDK。
 */
export function compactForModel(output: unknown, limitChars = MODEL_VIEW_LIMIT_CHARS): unknown {
  if (output == null || typeof output !== 'object') return output;
  if (size(output) <= limitChars) return output;
  let best: unknown = output;
  let bestStats: Stats = { arraysCut: 0, itemsHidden: 0 };
  for (const k of K_LADDER) {
    const stats: Stats = { arraysCut: 0, itemsHidden: 0 };
    const candidate = cut(output, k, stats, 0);
    best = candidate;
    bestStats = stats;
    if (size(candidate) <= limitChars) break;
  }
  const note: ModelViewNote = {
    truncated: true,
    arrays_cut: bestStats.arraysCut,
    items_hidden: bestStats.itemsHidden,
    note: '这是给模型的节选视图:列表已截断。完整结果已交给用户界面(卡片/面板),需要具体某条请用带过滤条件的工具再查,不要据此断言"只有这些"。',
  };
  if (Array.isArray(best)) return { _model_view: note, items: best };
  return { _model_view: note, ...(best as Record<string, unknown>) };
}

/** AI SDK `toModelOutput` 形状:模型收到的是 JSON 值。 */
export function toModelOutputCompact(output: unknown): { type: 'json'; value: unknown } {
  return { type: 'json', value: compactForModel(output) };
}
