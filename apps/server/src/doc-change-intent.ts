/**
 * 改文档之前那一问:**你要改的是这份文档,还是它描述的那件事?**
 *
 * 起因很具体:agent 把文档里「粗加工 → 金工分厂」改成「锻件分厂」,而系统里的
 * 排产规则一个字没动 —— 文档和系统对不上,两边看起来都正常,没人知道。
 * 这比改之前更糟:之前只是文档旧了,之后是**两份互相矛盾的事实**。
 *
 * 三条:
 * 1. **只在有"那件事"可改时才问。** 系统里查不到这条工序,就没有规则可改,
 *    问了是空转 —— 而每一次空转都在教人跳过这个问题。
 * 2. **给两个具体动作,不是"你确定吗"。** "确定吗"逼人重新想一遍他刚说过的话;
 *    "只改文档 / 文档+规则一起改"是他真正要做的选择。
 * 3. **把系统里的事实原样带上。** 人要据此判断,不该为了回答一个问题再去查一遍。
 */
import type { Verdict } from './doc-rule-reconcile.js';

export type ChangeIntent = {
  /** 要不要在改之前问 */
  ask: boolean;
  /** 问什么(ask=false 时为空串) */
  question: string;
  /** 两个具体动作 */
  options?: string[];
  /** 命中的那条对照结论 —— 调用方可以原样展示 */
  verdict?: Verdict;
};

const NO_ASK: ChangeIntent = { ask: false, question: '' };

/**
 * 这次要改的原文(`find`)对应哪条对照结论,据此决定问不问、问什么。
 *
 * 匹配用**原文引述**:对照结论里带着文档原文,这里拿要改的那段去对 ——
 * 比按工序名猜可靠,因为同一道工序可能在文档里出现好几次。
 */
export function changeIntent(find: string, verdicts: Verdict[]): ChangeIntent {
  const target = find.trim();
  if (!target || !verdicts.length) return NO_ASK;

  const hit = verdicts.find((v) => {
    const q = v.assertion.quote.trim();
    return q === target || q.includes(target) || target.includes(q);
  });
  // 系统里没有对应的事实 = 没有"那件事"可改。不问 —— 空转会教人跳过这个问题。
  if (!hit || hit.status === 'not_found' || hit.status === 'unverifiable') return NO_ASK;

  const subject = hit.assertion.subject;
  const mismatched = hit.status === 'conflict' || hit.status === 'partial';
  // detail 自己带前缀("一致:…""不一致:…"),再加一句"和系统是一致的"就成了
  // "一致的:一致:…"。这里只补 detail 没说的那半:改完会怎样。
  const head = hit.detail;
  const tail = mismatched
    ? `注意:这一句**本来就和系统对不上**。改文档只改变"文档说什么",系统照旧按它` +
      `自己的规则排 —— 改完两边仍然不一致。`
    : `改完之后,文档说的和系统在跑的就**不一样**了。`;

  return {
    ask: true,
    question:
      `${head}\n${tail}\n\n你要改的是**这份文档**,还是它描述的**那件事**(「${subject}」在系统里的规则)?`,
    options: [
      '只改文档 —— 文档是记录,系统照旧',
      '文档 + 规则一起改 —— 我来生成约束提案,走影子对比再批准',
    ],
    verdict: hit,
  };
}

/**
 * 把这一问挂到 `document_edit` 的结果上。
 *
 * **不拦。** 改完再问,不是改前设闸 —— 每改一句话多一轮往返,人会学会无脑点
 * "继续",那道闸就等于不存在了。而改本身有版本和一键撤销兜着(见
 * document-copy.ts),所以这里的正确姿态是"让他看见",不是"不让他改"。
 *
 * 改失败时不问:都没改成,问"你要改的是什么"是荒谬的。
 */
export function attachIntent<T extends { ok?: boolean }>(
  result: T,
  find: string,
  verdicts: Verdict[],
): T & { ask_next?: string; ask_options?: string[]; reconcile?: Verdict } {
  if (!result.ok) return result;
  const intent = changeIntent(find, verdicts);
  if (!intent.ask) return result;
  return {
    ...result,
    ask_next: intent.question,
    ...(intent.options ? { ask_options: intent.options } : {}),
    ...(intent.verdict ? { reconcile: intent.verdict } : {}),
  };
}

// —— 对照结论的暂存 ————————————————————————————————
//
// 对照(reconcile_document)和改(document_edit)是两次工具调用,而 requestContext
// 是只读的 —— 所以结论得在进程里存一下,那一问才问得出口。
//
// **键是 (项目, 文档)**:拿另一份文档的结论去问,问的就是错的东西。
// **有过期**:文档可能已经改过好几轮,旧结论未必还对得上。宁可不问,也不拿旧的问。
// (真改过的话,`find` 通常也对不上旧引述了,会自然退化成不问 —— 过期是第二道。)

const VERDICT_TTL_MS = 30 * 60_000;
const verdictCache = new Map<string, { at: number; verdicts: Verdict[] }>();

const cacheKey = (projectId: string, name: string) => `${projectId}\u0000${name}`;

export function rememberVerdicts(
  projectId: string,
  name: string,
  verdicts: Verdict[],
  at: number = Date.now(),
): void {
  verdictCache.set(cacheKey(projectId, name), { at, verdicts });
}

export function recallVerdicts(projectId: string, name: string): Verdict[] {
  const hit = verdictCache.get(cacheKey(projectId, name));
  if (!hit) return [];
  if (Date.now() - hit.at > VERDICT_TTL_MS) {
    verdictCache.delete(cacheKey(projectId, name));
    return [];
  }
  return hit.verdicts;
}
