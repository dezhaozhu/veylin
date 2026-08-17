/**
 * 文档说的 ↔ 系统在跑的,逐条对照。
 *
 * 起因很具体:agent 把工艺文档里「粗加工 → 金工分厂」改成了「锻件分厂」,而
 * **系统里的排产规则一个字没动**。文档和系统对不上,还没人知道 —— 这个状态比
 * 改之前更糟,因为两边都看起来正常。
 *
 * 分工照 [[deep-table-reading]] 那条已经验过的路:**LLM 提名,代码判定**。
 * 断言从文档里抽(模型干的活),对照是纯函数(这里),判据确定、可测、不靠模型
 * 当裁判。
 *
 * 三条不能让步的:
 * 1. **"系统里查不到" ≠ "文档错了"。** 前者是我们不知道,后者是判断。混成一个
 *    结论,人会照着一个我们其实没核对过的东西去改现场。
 * 2. **不做静默模糊匹配。**「金工分厂/外协」和「金工分厂」不是同一个值 ——
 *    可以报"部分对上",不能当成一致蒙混过去。
 * 3. **每条结论都带原文引述**,人能自己核对我们读得对不对。
 */

import { applyAliases, type OpAliases } from './op-aliases.js';

export type Assertion = {
  kind: 'op_resource' | 'capacity_k';
  /** 工序名 / 资源名 */
  subject: string;
  /** 文档说它是什么:部门名 / 数字 */
  object: string;
  /** 文档原文,原样带出 */
  quote: string;
};

export type Fact =
  | {
      kind: 'op_resource';
      op: string;
      /** 历史上真跑过这道工序的资源,按占比降序 */
      resources: Array<{ name: string; share: number }>;
      flexibility: 'locked' | 'limited' | 'flexible';
    }
  | { kind: 'capacity_k'; resource: string; k: number; source: string };

export type Status =
  /** 文档说的和系统一致 */
  | 'agree'
  /** 文档说的和系统不一样 —— 要看的第一档 */
  | 'conflict'
  /** 沾边但不等同(例如文档写的是组合值) */
  | 'partial'
  /** 系统里没有这个东西 —— **我们不知道,不是文档错了** */
  | 'not_found'
  /** 断言本身没法机器核对 */
  | 'unverifiable';

export type Verdict = {
  assertion: Assertion;
  status: Status;
  detail: string;
  /**
   * 系统侧现在在用的资源(仅 op_resource,且**查得到时才有**)。
   *
   * detail 里那句话是给人读的 —— 下游(生成规则提案时要说"这条会排除谁")
   * 不该去解析它。查不到时**不给空数组**:空数组会被读成"系统里一个资源都没有",
   * 而事实是"我们没有它的记录"。
   */
  systemResources?: string[];
  /**
   * 系统里名字相近的工序(仅 not_found)。**结构化给出来**,上层才能把它变成一个
   * 可点的"这两个是同一道吗" —— 只写在 detail 那句话里,人只能自己再打一遍。
   */
  aliasCandidates?: string[];
};

/** 结论顺序 = **人要看的顺序**:先看不一致的,一致的排最后。 */
const ORDER: Record<Status, number> = {
  conflict: 0, partial: 1, unverifiable: 2, not_found: 3, agree: 4,
};

const norm = (s: string) => s.trim().replace(/\s+/g, '');
const pct = (n: number) => `${Math.round(n * 100)}%`;

/** 文档里的组合值:「金工分厂/外协」「金工分厂、外协」 */
const splitCombo = (s: string) =>
  norm(s).split(/[/、,,;;+]/).map((x) => x.trim()).filter(Boolean);

/**
 * 系统里名字相近的工序 —— **给线索,不替他认定**。
 *
 * 真数据实测:上重 11 个文档工序名只有 2 个一字不差对得上。只回一句"查不到"是条
 * 死胡同,而系统里明明有相近的。判定仍然是"查不到" —— 相近**不是**同一道工序,
 * 这条线不能越;要认得由人来认(confirm_op_alias)。
 *
 * 判据经过一次修正:原来只认"一方包含另一方",结果**恰恰漏掉了它存在的理由** ——
 * 「最终验收」和「最终检验」谁也不包含谁,一条候选都不给,人永远不会被提示去登记。
 * **保守到没用,和乱猜一样是失败。** 现在两条,都要能讲得出道理:
 *   1. 一方包含另一方(性能热处理 ⊂ 性能热处理-冶铸)
 *   2. **前两个字相同,长度相近,且过半的字重合**(最终验收 / 最终检验)
 * 仍然不用编辑距离:说不清为什么算相近的候选,会把人带偏。
 */
function nearMisses(subject: string, facts: Fact[]): string[] {
  const q = norm(subject);
  if (q.length < 2) return [];
  const chars = new Set(q);
  const similar = (o: string) => {
    if (o === q) return false;
    if (o.includes(q) || q.includes(o)) return true;
    // 前两个字是同一个词头 —— 工序名的区别几乎总在后半截(验收/检验、粗加工/精加工)
    if (o.slice(0, 2) !== q.slice(0, 2)) return false;
    if (Math.abs(o.length - q.length) > 1) return false;
    const shared = [...new Set(o)].filter((c) => chars.has(c)).length;
    return shared / Math.max(q.length, o.length) >= 0.5;
  };
  return facts
    .filter((f): f is Extract<Fact, { kind: 'op_resource' }> => f.kind === 'op_resource')
    .map((f) => f.op)
    .filter((op) => similar(norm(op)))
    .slice(0, 3);
}

function checkOpResource(a: Assertion, facts: Fact[]): Verdict {
  const fact = facts.find((f) => f.kind === 'op_resource' && norm(f.op) === norm(a.subject));
  if (!fact || fact.kind !== 'op_resource') {
    const near = nearMisses(a.subject, facts);
    return {
      assertion: a,
      status: 'not_found',
      // 措辞要守住第 1 条:说的是我们查不到,不是文档不对。
      detail:
        `系统里查不到「${a.subject}」这道工序的历史记录 —— 无法核对(不代表文档写错了)。` +
        (near.length ? `系统里有名字相近的:${near.join('、')} —— 是不是同一道,得你来认。` : ''),
      ...(near.length ? { aliasCandidates: near } : {}),
    };
  }
  const names = fact.resources.map((r) => norm(r.name));
  const parts = splitCombo(a.object);
  const hit = fact.resources.find((r) => norm(r.name) === norm(a.object));
  if (hit) {
    // **对上了,但对的是次要的那个**,不能报"一致"(真数据实测:文档说
    // 「取样→金工分厂」,系统里金工分厂只占 30%,主力是大锻所 70%)。
    // 判成一致等于告诉人"这条没问题",他就不会再看了 —— 而文档指的其实是
    // 次要的那条路。
    const top = fact.resources.reduce((m, r) => (r.share > m.share ? r : m), fact.resources[0]!);
    if (norm(top.name) !== norm(hit.name)) {
      return {
        assertion: a,
        status: 'partial',
        detail:
          `对上了,但不是主力:系统里「${a.subject}」主要跑在「${top.name}」(${pct(top.share)}),` +
          `文档写的「${hit.name}」只占 ${pct(hit.share)}。`,
        systemResources: fact.resources.map((r) => r.name),
      };
    }
    return {
      assertion: a,
      status: 'agree',
      detail: `一致:系统里「${a.subject}」有 ${pct(hit.share)} 的工序跑在「${hit.name}」(${fact.flexibility})。`,
      systemResources: fact.resources.map((r) => r.name),
    };
  }
  const overlap = parts.filter((p) => names.includes(p));
  if (overlap.length) {
    return {
      assertion: a,
      status: 'partial',
      detail:
        `部分对上:文档写的是组合值「${a.object}」;系统里实际是 ` +
        fact.resources.map((r) => `${r.name} ${pct(r.share)}`).join('、') + '。',
      systemResources: fact.resources.map((r) => r.name),
    };
  }
  return {
    assertion: a,
    status: 'conflict',
    detail:
      `不一致:文档说「${a.subject}」由「${a.object}」做;` +
      `系统里实际是 ${fact.resources.map((r) => `${r.name} ${pct(r.share)}`).join('、')}。`,
    systemResources: fact.resources.map((r) => r.name),
  };
}

function checkCapacityK(a: Assertion, facts: Fact[]): Verdict {
  const fact = facts.find((f) => f.kind === 'capacity_k' && norm(f.resource) === norm(a.subject));
  if (!fact || fact.kind !== 'capacity_k') {
    return {
      assertion: a,
      status: 'not_found',
      detail: `系统里没有「${a.subject}」这个资源的产能记录 —— 无法核对(不代表文档写错了)。`,
    };
  }
  // 先看剥掉非数字之后还剩不剩东西:`Number('')` 是 **0**,不判这一步的话
  // 「很多」会被当成 0,然后和真实的 K 比出一个煞有介事的"不一致"。
  const digits = String(a.object).replace(/[^\d.]/g, '');
  const n = Number(digits);
  if (digits === '' || !Number.isFinite(n)) {
    // 不硬比:把"很多""若干"当成数字,只会造出一个假结论。
    return { assertion: a, status: 'unverifiable', detail: `文档写的是「${a.object}」,不是一个数,没法机器核对。` };
  }
  if (n === fact.k) {
    return { assertion: a, status: 'agree', detail: `一致:系统里也是 ${fact.k}(来源:${fact.source})。` };
  }
  return {
    assertion: a,
    status: 'conflict',
    detail: `不一致:文档说 ${n},系统里在用 ${fact.k}(来源:${fact.source})。`,
  };
}

export function reconcile(
  assertions: Assertion[],
  facts: Fact[],
  /** 人确认过的工序名对照表(文档词 → 系统词)。见 op-aliases.ts。 */
  aliases: OpAliases = {},
): Verdict[] {
  const out = assertions.map((raw) => {
    // **先过对照表**:文档说「最终验收」、系统里叫「最终检验」—— 不换名的话
    // 这条永远是"查不到"(真数据里 11 条只有 2 条能一字不差对上)。
    const subject = applyAliases(raw.subject, aliases);
    const a = subject === raw.subject ? raw : { ...raw, subject };
    const v = a.kind === 'capacity_k' ? checkCapacityK(a, facts) : checkOpResource(a, facts);
    // 结论里回原始断言 —— 引述和上层的匹配都按文档原话来。
    return subject === raw.subject ? v : { ...v, assertion: raw };
  });
  // 稳定排序:同档内保持文档里的原顺序,人能顺着文档读下来。
  return out
    .map((v, i) => ({ v, i }))
    .sort((x, y) => ORDER[x.v.status] - ORDER[y.v.status] || x.i - y.i)
    .map(({ v }) => v);
}
