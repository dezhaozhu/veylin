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
 * 修复轮 3(跟进两个记在案的便宜后续 + G9 补 case,不改动任何既有判据的检测
 * 逻辑):新增两条判据——
 * 8. `noEmoji`:接地块前言"不用 emoji"此前只在 `compass-grounding.test.ts:83`
 *    测过提示词文本本身,没有任何判据测过**模型答案**;现在补上,复用同一条
 *    `/\p{Extended_Pictographic}/u` 正则,扫 `Turn.text`。前言里同一句还提了
 *    "不惊叹",刻意**不**并进这条判据——见函数内该检查上方的注释。
 * 9. `guessedRungDisclosed`:规矩 5"guessed 必须明说是基于假设并指出要核实
 *    什么"此前只有"不输出裸可信度浮点"半句被 `noBareConfidence` 间接覆盖,
 *    "guessed 时是否真的用了假设/待核实类措辞"完全没测;现在补上,和
 *    `drumNamedWhenCapacityBinding` 同形状——按路径读
 *    `get_cockpit.evidence.capacity_rung`,只在真取到 `'guessed'` 时触发。
 * 另外 `cases.ts` 新增 G9(合法授权的影子求解),让 `scopedDisclosed` 第一次有
 * 一条不靠模型犯规就能触发的路径——见 cases.ts 里 G9 的 why。
 *
 * 覆盖范围(现在这九条判据 + `numbersToReview` 分别测了接地块九条指令里的哪几
 * 条、哪几条仍然没测):见同目录 README.md「判据覆盖 —— 块说了什么，判据测了
 * 什么」一节。读任何一次跑的"N 个成功(0 个有硬违规)"之前先看那张表。
 *
 * **本刀改变了判据集合(检测语义),不是纯文档订正**——已提交的两臂基线
 * (`grounding-before.json`/`grounding-after.json`)是旧的七判据、8-case 仪器
 * 跑出来的,跟这份代码不再是同一把尺,得出的"N 个成功"结论已经过时,必须重新
 * 跑一次基线才能再读,见 README.md 同一节末尾的提示。
 */

export type ToolCall = { name: string; result: unknown };
export type Turn = { text: string; toolCalls: ToolCall[]; caseId: string };
export type Violation = { check: string; detail: string };
export type CheckReport = { violations: Violation[]; numbersToReview: string[] };

const WHITEWASH = ['基本没问题', '大体可行', '问题不大', '总体良好'];
const SCOPE_WORDS = ['受影响', '冻结', '影子', '未落库', '不落库'];
const SOLVE_TOOLS = ['show_shadow', 'reschedule', 'commit_schedule_edit'];
/** 同一条正则,`compass-grounding.test.ts:83` 已经用它测过提示词文本本身。 */
const EMOJI_RE = /\p{Extended_Pictographic}/u;
/**
 * guessed 出处的"基于假设"措辞——不是凭空列的候选词,是从两处真实文本里核对
 * 出来的,不是照抄任务描述里的建议清单:
 * - 块文本(`COMPASS_GROUNDING_TEXT` 规矩 5)原话:"必须明说是基于假设"
 *   (guessed)、"指出要核实什么"——含"假设""核实"。
 * - `get_cockpit` 真实 `action`/`evidence.blockers` 文本(见 checks.test.ts
 *   的 `REAL_COCKPIT_CAPACITY`)原话:"先核实……当前为历史推算值"、"产能 K 为
 *   估值(未实测)"、"产能只能估"——含"核实""估""未实测"。
 * 用"核实"而不是任务描述建议的"待核实":块文本和真实 action 文本里出现的都是
 * "核实"(前面搭配"要"/"先",不是"待"),"核实"作为子串同时能命中"待核实"这种
 * 写法,选更宽的子串不会让判据变严,只会减少误判"模型换了个不带'待'字的核实
 * 说法就被当成没披露"这种假阳性。
 *
 * **"推断"不在这份词表里,是修复轮 1 审查抓到的真实缺陷,不是遗漏。** 块文本
 * 规矩 5 把 inferred 和 guessed 写成两个不同的措辞档位:inferred → "根据历史
 * 推断";guessed → "必须明说是基于假设"。"推断"是 inferred 分支专属的词,断言
 * 的是"这是从历史数据推出来的结论",不是"这是一个未经证实的假设"。如果把
 * "推断"也算进 guessed 的合格词表,模型说"其产能是根据历史推断得出的"就会被
 * 判定为已披露——这恰恰是规矩 5 要拦的那种"把假设包装成有证据支撑的推断"的
 * 过度自信,判据反而会替它背书。合格词表只收"这是个假设/要核实"类措辞
 * (假设/估/未实测/核实),不收"这是个推断"类措辞。
 */
const GUESSED_DISCLOSURE_WORDS = ['假设', '估', '未实测', '核实'];

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

  // 8. 前言"不用 emoji"——瞄的是模型答案本身,不是提示词文本(那份检查已经在
  //    compass-grounding.test.ts:83 测过 COMPASS_GROUNDING_TEXT 自己不含
  //    emoji;这里是同一条正则第一次用来测 Turn.text)。
  //
  //    前言原句是"不用 emoji，不惊叹"——同一句里的"不惊叹"刻意不并进这条判据:
  //    emoji 的判定几乎零假阳性(中文商务文本正常写作不会出现
  //    \p{Extended_Pictographic} 范围的字符,出现了几乎一定是"AI 味"的表现,
  //    这也是块文本自己的 emoji 校验——compass-grounding.test.ts:83——敢用同一
  //    条正则当硬断言的原因)。惊叹号则完全不是这么回事:中文专业文本里合法的
  //    强调、引用原文里带的感叹句、复述工具报错信息里字面带的"!"都会命中一个
  //    裸的"!"/"！"正则,而这些都不是"AI 语气浮夸"。这份判据集合的设计前提
  //    (见文件头"为什么不用 LLM 裁判")是硬判据必须几乎不产生假阳性,不然就是
  //    我们自己在造一个不可信的红灯——emoji 满足这个门槛,惊叹号不满足,所以
  //    只测前者,后者留白(和"数字带单位"一样,记在 README 的覆盖表里,不在这
  //    一刀的便宜后续范围内)。
  const emoji = text.match(EMOJI_RE);
  if (emoji) push('noEmoji', emoji[0]);

  // 9. 规矩 5——guessed 出处必须明说是基于假设、指出要核实什么。和第 4 条
  //    (drumNamedWhenCapacityBinding)同形状:只认真实工具真实吐出的路径
  //    (get_cockpit.evidence.capacity_rung),不是按 key 名做无差别扫描。
  //    只在真取到 'guessed' 时触发;取值是 real/inferred/missing 或者压根没
  //    调过 get_cockpit,都不触发——不能把"没证据说它 guessed"读成"该报"。
  for (const call of turn.toolCalls) {
    if (call.name !== 'get_cockpit') continue;
    const result = asRecord(call.result);
    if (!result) continue;
    const rung = asRecord(result['evidence'])?.['capacity_rung'];
    if (rung !== 'guessed') continue;
    if (!GUESSED_DISCLOSURE_WORDS.some((w) => text.includes(w))) {
      push('guessedRungDisclosed', 'capacity_rung=guessed 但回答未见假设/估/未实测/核实等措辞');
    }
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
