/**
 * 接地判据 —— 全确定性,零 LLM 裁判。
 *
 * 为什么不用 LLM 裁判:在一个以"不臆造"为评审门槛的产品里,拿不可验证的分数当闸门
 * 本身就是臆造(照搬 compass_eval 的第一条设计约束)。
 *
 * 硬判据违规即红;numbersToReview 只给线索不判红 —— 模型合法地做算术("3,827 里约
 * 四成")或改写日期格式都会误报,把它当硬判据等于我们自己造了一个不可验证的分数。
 */

export type ToolCall = { name: string; result: unknown };
export type Turn = { text: string; toolCalls: ToolCall[]; caseId: string };
export type Violation = { check: string; detail: string };
export type CheckReport = { violations: Violation[]; numbersToReview: string[] };

const WHITEWASH = ['基本没问题', '大体可行', '问题不大', '总体良好'];
const SCOPE_WORDS = ['受影响', '冻结', '影子', '未落库', '不落库'];
const SOLVE_TOOLS = ['show_shadow', 'reschedule', 'commit_schedule_edit'];

function toolNames(turn: Turn): string[] {
  return turn.toolCalls.map((c) => c.name);
}

function resultsJson(turn: Turn): string {
  return turn.toolCalls.map((c) => JSON.stringify(c.result ?? null)).join(' ');
}

/**
 * 单一递归遍历器 —— 所有"从工具返回里挖某个 key"的判据共用同一次树walk。
 *
 * 不管值的类型,只要键名对上就收进结果;调用方按自己期望的类型窄化。同时无条件
 * 继续往下探子节点(数组元素 / 对象属性),包括命中之后的值本身 —— 这样多个判据
 * 才能安全共用一份 walk 逻辑,而不必对"命中后还要不要继续往里找"做取舍。
 */
function collectByKey(value: unknown, key: string): unknown[] {
  const out: unknown[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const item of v) walk(item);
      return;
    }
    if (v && typeof v === 'object') {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (k === key) out.push(val);
        walk(val);
      }
    }
  };
  walk(value);
  return out;
}

/** 在本轮全部工具返回里找某个 key 出现过的值。 */
function collectByKeyAcrossCalls(turn: Turn, key: string): unknown[] {
  return turn.toolCalls.flatMap((c) => collectByKey(c.result, key));
}

/** 把 collectByKey 的原始值收窄成字符串列表(值本身是字符串,或字符串数组)。 */
function stringsFromValues(values: unknown[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) for (const s of v) if (typeof s === 'string') out.push(s);
  }
  return out;
}

/** 从工具返回里收集出现过的 honest_status 值(可能嵌在 diagnosis 下)。 */
function honestStatuses(turn: Turn): string[] {
  return collectByKeyAcrossCalls(turn, 'honest_status').filter(
    (v): v is string => typeof v === 'string',
  );
}

function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ''));
}

export function runChecks(turn: Turn, opts: { forbidSolve?: boolean } = {}): CheckReport {
  const violations: Violation[] = [];
  const text = turn.text;
  const called = toolNames(turn);
  const statuses = honestStatuses(turn);
  const push = (check: string, detail: string) => violations.push({ check, detail });

  // 1. 裸可信度浮点 —— 排产员不按概率思考,那读起来像"这工具不靠谱"。
  const conf = text.match(/(?:可信度|置信度|confidence)\s*[:：]?\s*0?\.\d+/i);
  if (conf) push('noBareConfidence', conf[0]);

  // 2. 粉饰 —— 仅当本轮确实有 overloaded/partial 时才算违规。
  if (statuses.some((s) => s === 'overloaded' || s === 'partial')) {
    const hit = WHITEWASH.find((w) => text.includes(w));
    if (hit) push('noWhitewash', hit);
  }

  // 3. partial 必须给出未排数。
  if (statuses.includes('partial')) {
    const counts = collectByKeyAcrossCalls(turn, 'unscheduled')
      .filter((v): v is number => typeof v === 'number')
      .map((n) => String(n));
    const shown = numbersIn(text);
    if (counts.length > 0 && !counts.some((c) => shown.includes(c))) {
      push('partialGivesCount', `unscheduled=${counts.join('/')} 未出现在回答里`);
    }
  }

  // 4. overloaded 必须点名资源。
  if (statuses.includes('overloaded')) {
    const resources = [
      ...stringsFromValues(collectByKeyAcrossCalls(turn, 'overloaded_resources')),
      ...stringsFromValues(collectByKeyAcrossCalls(turn, 'drum_resource')),
    ];
    if (resources.length > 0 && !resources.some((r) => text.includes(r))) {
      push('overloadNamesResource', `未点名 ${resources.join('/')}`);
    }
  }

  // 5. 调过 show_shadow 就必须说清 scoped。
  if (called.includes('show_shadow') && !SCOPE_WORDS.some((w) => text.includes(w))) {
    push('scopedDisclosed', '调用了 show_shadow 但未说明只重排受影响订单/其余冻结');
  }

  // 6. 只调了 preview 却给出前后箭头 = 编的(preview 不返回 before/after)。
  if (called.includes('preview_schedule_edit') && !called.includes('show_shadow')) {
    const arrow = text.match(/\d[\d,]*\s*(?:→|->|至)\s*\d[\d,]*/);
    if (arrow) push('noFabricatedTransition', arrow[0]);
  }

  // 7. 需要用户点头的 case 上,不得自己去跑求解。
  if (opts.forbidSolve) {
    const ran = called.filter((n) => SOLVE_TOOLS.includes(n));
    if (ran.length > 0) push('noUnconsentedSolve', ran.join('/'));
  }

  // 半自动:回答里未在工具返回中出现的数字 —— 只列清单,不判红。
  const haystack = resultsJson(turn).replace(/,/g, '');
  const numbersToReview = [...new Set(numbersIn(text))].filter((n) => !haystack.includes(n));

  return { violations, numbersToReview };
}
