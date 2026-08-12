/**
 * 接地判据 —— 全确定性,零 LLM 裁判。
 *
 * 为什么不用 LLM 裁判:在一个以"不臆造"为评审门槛的产品里,拿不可验证的分数当闸门
 * 本身就是臆造(照搬 compass_eval 的第一条设计约束)。
 *
 * 硬判据违规即红;numbersToReview 只给线索不判红 —— 模型合法地做算术("3,827 里约
 * 四成")或改写日期格式都会误报,把它当硬判据等于我们自己造了一个不可验证的分数。
 *
 * 修复轮 1:第一版按 key 名对整棵返回树做无差别扫描(“看到叫 honest_status /
 * unscheduled / overloaded_resources 的 key 就收”),字段名是从 spec 文档臆造
 * 的,不是从真实 payload 来的 —— 拿真实 compass smoke 数据一跑,三条判据结构性
 * 失活(该 smoke 文件本身是 gitignored 的临时采集产物,早已不在盘上;裁剪后的
 * 真实结构和真实取值现在以 `checks.test.ts` 里的 `REAL_*` fixtures 的形式留存,
 * 那才是这份证据现在的可复现形态):
 * `get_health` 从不吐顶层 `honest_status`,也没有任何工具吐 `overloaded_resources`。
 * 现在改成按路径读——只认真实工具真实吐出的两个位置,不再做“任意深度按 key 名扫”,
 * 因为真实数据里恰好有同名诱饵(`get_cockpit.status` 是交付风险色,
 * `get_health.history[].status`/`unscheduled` 是过往版本的旧值),按 key 名扫会
 * 把诱饵当成本轮事实。
 *
 * 修复轮 2(纯文档订正,判据逻辑不变):`currentRunStatuses` 里关于
 * `metrics.status` 的注释此前写错了 —— 对照 compass-v2 源码
 * (`run_report_service.py:223`/`:236`)后订正,见下方函数注释。
 *
 * 覆盖范围(这七条判据 + `numbersToReview` 分别测了接地块九条指令里的哪几条、
 * 哪几条完全没测):见同目录 README.md「判据覆盖 —— 块说了什么，判据测了什么」
 * 一节。读任何一次跑的"N 个成功(0 个有硬违规)"之前先看那张表 —— 四条指令
 * (含规矩 3 的 `scopedDisclosed`,一个已知盲区)当前完全没有判据能测到,不代表
 * 已验证。
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

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

/**
 * 本轮“运行状态” —— 只认两条真实路径,别的一律不算:
 *
 * - `diagnosis.honest_status`(仅 `preview_schedule_edit` 会吐;四态
 *   feasible/partial/overloaded/infeasible,源自 compass 的
 *   `compass_domain.diagnosis.RunDiagnosis.honest_status`)。
 * - `metrics.status`(仅 `get_health` 会吐)。已对照 compass-v2 源码逐行核实
 *   真实推导 —— `compass_api/run_report_service.py:236`:
 *   `status = diag.honest_status if diag else cur.status`。也就是说
 *   `metrics.status` 优先取的就是这一轮的 `honest_status`,跟上面
 *   `diagnosis.honest_status` 是同一套四态、同一个字段来源,合法取值里就有
 *   `overloaded`;只有这一行运行没有存下 diagnosis(老/降级行)时才退到
 *   `cur.status`(持久化时由 `compass_app.validate.classify_status` 写入,
 *   该函数目前只会产出 feasible/infeasible,partial/timeout/error 是类型上
 *   预留但当前推不出的取值)。上一版这里写反了,说 `metrics.status` 是
 *   `classify_status` 的 `SolveStatus`、没有 overloaded 这个态——那是任务
 *   协调者转述时的错误,一读源码就能证伪,已订正。
 *
 * 两个诱饵、路径之外一律不采:
 * - `get_cockpit.status` 是交付风险色(red/amber/green),跟运行状态压根不
 *   是一套词表,肉眼就能分辨。
 * - `get_health.history[].status` 才是真正危险的诱饵:
 *   `run_report_service.py:223` 显示它是跟 `metrics.status` 完全相同的推导
 *   (`hd.honest_status if hd else run.status`),只是套在每一条历史记录上
 *   而不是这一轮 —— 跟本轮状态共享同一套四态词表,真实数据里就见过
 *   history[] 条目取值 "overloaded"。光看取值本身分不出这是本轮还是十条以
 *   前的某次跑,唯一能分辨的是它出现在 `history[]` 数组里、不在 `metrics`
 *   下——所以必须按路径认,不能按 key 名认,也不能靠"这个词表看起来像不像
 *   本轮"这种直觉认。
 *
 * 不在这里把 timeout/error 折算成四态之一 —— 那是编造对应关系,判据宁可对这两
 * 个值不触发,也不要猜。
 */
function currentRunStatuses(turn: Turn): string[] {
  const out: string[] = [];
  for (const call of turn.toolCalls) {
    const result = asRecord(call.result);
    if (!result) continue;
    const honestStatus = asRecord(result['diagnosis'])?.['honest_status'];
    if (typeof honestStatus === 'string') out.push(honestStatus);
    const solveStatus = asRecord(result['metrics'])?.['status'];
    if (typeof solveStatus === 'string') out.push(solveStatus);
  }
  return out;
}

/**
 * 本轮“未排数” —— 同样只认两条真实路径:`diagnosis.unscheduled`
 * (`preview_schedule_edit`)和 `metrics.orders_unscheduled`(`get_health`)。
 * `history[].unscheduled` 是过往版本的未排数,同一个诱饵问题,不采。
 */
function currentRunUnscheduledCounts(turn: Turn): number[] {
  const out: number[] = [];
  for (const call of turn.toolCalls) {
    const result = asRecord(call.result);
    if (!result) continue;
    const fromDiagnosis = asRecord(result['diagnosis'])?.['unscheduled'];
    if (typeof fromDiagnosis === 'number') out.push(fromDiagnosis);
    const fromMetrics = asRecord(result['metrics'])?.['orders_unscheduled'];
    if (typeof fromMetrics === 'number') out.push(fromMetrics);
  }
  return out;
}

function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ''));
}

export function runChecks(turn: Turn, opts: { forbidSolve?: boolean } = {}): CheckReport {
  const violations: Violation[] = [];
  const text = turn.text;
  const called = toolNames(turn);
  const statuses = currentRunStatuses(turn);
  const push = (check: string, detail: string) => violations.push({ check, detail });

  // 1. 裸可信度浮点 —— 排产员不按概率思考,那读起来像"这工具不靠谱"。
  const conf = text.match(/(?:可信度|置信度|confidence)\s*[:：]?\s*0?\.\d+/i);
  if (conf) push('noBareConfidence', conf[0]);

  // 2. 粉饰 —— honest_status 的 overloaded 和 SolveStatus 的 partial 是两套
  //    不同的四/五态词表,这里当并集处理:任一命中就算"本轮确实有问题"。
  if (statuses.some((s) => s === 'overloaded' || s === 'partial')) {
    const hit = WHITEWASH.find((w) => text.includes(w));
    if (hit) push('noWhitewash', hit);
  }

  // 3. partial 必须给出未排数(两个真实来源任一给出的数都算数)。
  if (statuses.includes('partial')) {
    const counts = currentRunUnscheduledCounts(turn).map((n) => String(n));
    const shown = numbersIn(text);
    if (counts.length > 0 && !counts.some((c) => shown.includes(c))) {
      push('partialGivesCount', `unscheduled=${counts.join('/')} 未出现在回答里`);
    }
  }

  // 4. 驾驶舱判定"卡在产能"时必须点名鼓资源。
  //    没有任何工具会吐 overloaded_resources ——那是 compass 内部
  //    `RunDiagnosis.resource_overloads` 的字段名,没有暴露给 agent;真实能读
  //    到的是 get_cockpit 在 binding === 'capacity' 时给的
  //    evidence.drum_resource。
  for (const call of turn.toolCalls) {
    if (call.name !== 'get_cockpit') continue;
    const result = asRecord(call.result);
    if (!result || result['binding'] !== 'capacity') continue;
    const drum = asRecord(result['evidence'])?.['drum_resource'];
    if (typeof drum === 'string' && drum.length > 0 && !text.includes(drum)) {
      push('drumNamedWhenCapacityBinding', `未点名 ${drum}`);
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

  // 半自动:回答里未在工具返回中出现的数字 —— 只列清单,不判红。这里是把整轮
  // 工具返回 JSON.stringify 后拼一起做裸子串匹配,不是按字段核对来源;真实
  // payload 里到处是订单号/时间戳/设备编号这类数字,一个跟本轮结论毫不相干的
  // 数字很容易在别处"碰巧"命中子串而被判定为已接地——这份清单只会漏报、不
  // 会多报,不能把"没进这份清单"读成"已核实"。
  const haystack = resultsJson(turn).replace(/,/g, '');
  const numbersToReview = [...new Set(numbersIn(text))].filter((n) => !haystack.includes(n));

  return { violations, numbersToReview };
}
