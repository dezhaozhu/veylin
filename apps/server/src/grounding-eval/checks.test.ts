import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runChecks, type Turn } from './checks.js';

const turn = (over: Partial<Turn>): Turn => ({
  caseId: 'T',
  text: '',
  toolCalls: [],
  ...over,
});

const names = (t: Turn, opts?: { forbidSolve?: boolean }) =>
  runChecks(t, opts).violations.map((v) => v.check);

/**
 * 修复轮 1 fixtures ——从真实 smoke 抓取(原文件 apps/server/eval-runs/grounding-
 * smoke.json,14 条真实 agent turn,tenant=guolu/shangzhong)裁剪而来,保留真实
 * 结构和真实 key 路径。逐条标注取自哪个 sampleId/工具/路径,以及哪些字段值是
 * 为了触发某个判据而手工替换的(真实语料 14+6 条样本里一条 `partial`/
 * `overloaded`(取 metrics.status 或 diagnosis.honest_status 路径)、`timeout`、
 * `error` 都没出现过——核实为 0 的时点见下)。路径本身(diagnosis.honest_status /
 * metrics.status / metrics.orders_unscheduled / get_cockpit.evidence.drum_resource /
 * history[].status)在真实语料里都出现过,只是触发值需要替换。
 *
 * 该 smoke 文件是 gitignored 的临时采集产物,早已不在盘上,下面这条 grep
 * 已经无法重跑:
 *   grep -c '"partial"' apps/server/eval-runs/grounding-smoke*.json
 * 但结论不因此失效——这些 `REAL_*` 常量就是那次核实结果的**永久留存形态**
 * (硬编码进这份已提交的测试文件里),不是指向一个易失文件的转述;要复核就
 * 直接读下面这些常量本身,不需要也不能重新生成那个源文件。
 */

/**
 * grounding:G1:shangzhong:1, get_health, 裁剪 history 到 4 条(保留最新两条
 * feasible + 最老两条 infeasible),去掉 diff/delay_report/rules_health 等本
 * 判据用不到的大字段。metrics.status / orders_unscheduled 均为真实值(未改)。
 */
const REAL_HEALTH_FEASIBLE = {
  empty: false,
  run_id: 'tenantrun-2026-07-24T03:29:13.012724',
  created_at: '2026-07-24 03:29:13.012724',
  metrics: {
    status: 'feasible',
    jobs_assigned: 30923,
    orders_late: 4419,
    orders_unscheduled: 0,
    plan_method: 'approximate',
  },
  history: [
    {
      run_id: 'tenantrun-2026-07-24T03:29:13.012724',
      created_at: '2026-07-24 03:29:13.012724',
      status: 'feasible',
      unscheduled: 0,
    },
    {
      run_id: 'tenantrun-2026-07-23T15:05:08.041950',
      created_at: '2026-07-23 15:05:08.041950',
      status: 'feasible',
      unscheduled: 0,
    },
    {
      run_id: 'tenantrun-2026-06-22T03:16:06.685958',
      created_at: '2026-06-22 03:16:06.685958',
      status: 'infeasible',
      unscheduled: 4104,
    },
    {
      run_id: 'tenantrun-2026-06-22T02:07:28.114171',
      created_at: '2026-06-22 02:07:28.114171',
      status: 'infeasible',
      unscheduled: 4104,
    },
  ],
  tenant: 'shangzhong',
};

/**
 * SYNTHESIZED VALUE。同上真实 get_health 的路径与结构原样保留,只把
 * `metrics.status` 从真实值 'feasible' 换成 'partial'、`orders_unscheduled`
 * 从 0 换成 96 —— 因为 14+6 条真实语料里 metrics.status 从未取到 partial(全
 * 是 feasible)。换值不换路径:这正是本轮要验证的东西——旧版判据按顶层
 * `honest_status` 这个从没在任何真实 get_health 返回里出现过的 key 找,不管
 * status 是什么值都读不到;新版按 `metrics.status` 这条真实路径找,只要路径
 * 对、值对就能读到。
 */
const REAL_HEALTH_PARTIAL_STATUS_SUBSTITUTED = {
  ...REAL_HEALTH_FEASIBLE,
  metrics: { ...REAL_HEALTH_FEASIBLE.metrics, status: 'partial', orders_unscheduled: 96 },
};

/**
 * SYNTHESIZED HISTORY ENTRY,其余取自 REAL_HEALTH_FEASIBLE。本轮当前状态
 * (metrics.status)保持真实值 'feasible' 不变,只在 history[0] 这一条真实存在
 * 的记录上把 status/unscheduled 换成 'partial'/40,用来专门验证:即便"过往
 * 版本"里出现 partial,只要当前 metrics.status 不是 partial,判据也不该触发
 * ——history[] 是诱饵,不是本轮事实。
 */
const REAL_HEALTH_HISTORY_PARTIAL_DECOY = {
  ...REAL_HEALTH_FEASIBLE,
  history: [
    { ...REAL_HEALTH_FEASIBLE.history[0], status: 'partial', unscheduled: 40 },
    ...REAL_HEALTH_FEASIBLE.history.slice(1),
  ],
};

/**
 * grounding:G1:shangzhong:1 (也是 G2/G3/G4/G6/G8:shangzhong:1 的重复值),
 * get_cockpit,binding === 'capacity' 分支,完整未删减(真实 status: 'red' 决
 * 策色诱饵 + 真实 evidence.drum_resource: 'YZ0202-4')。
 */
const REAL_COCKPIT_CAPACITY = {
  binding: 'capacity',
  status: 'red',
  headline: '3,827 个订单预计延期，最长 98 天',
  sub: null,
  cause: '瓶颈资源 YZ0202-4 负荷远超其产能，全厂节奏受它限制。',
  action: '先核实 YZ0202-4 的并行台数（K）——当前为历史推算值；确认后再决定给最急订单加急或改期。',
  drills: [
    { label: '查看迟到订单', tool: 'get_schedule_rows', params: { status: 'late' } },
    { label: '查看该资源', tool: 'get_resources', params: {} },
  ],
  compare: { kind: 'prev', label: '较上版', before_late: 3827, after_late: 3827, delta: 0 },
  evidence: {
    capacity_rung: 'guessed',
    due_rung: 'inferred',
    drum_resource: 'YZ0202-4',
    drum_utilization: 16.408,
    n_saturated: 14,
    late_orders: 3827,
    max_late_days: 98,
    blockers: ['交期 81% 陈旧', '产能 K 为估值(未实测)', '无完工历史,产能只能估'],
  },
  tenant: 'shangzhong',
};

/**
 * grounding:G1:guolu:1,get_cockpit,binding === 'data_trust' 分支,完整未删
 * 减 —— 用来证明 binding 不是 capacity 时,即便 evidence.drum_resource 也存在
 * (真实值就是有的:"上锅,七星"),判据也不该触发。
 */
const REAL_COCKPIT_DATA_TRUST = {
  binding: 'data_trust',
  status: 'amber',
  headline: '2,668 个订单显示延期，暂不宜据此判断',
  sub: null,
  cause: '多数延期源于交期数据陈旧，而非产能不足；产能侧当前未构成瓶颈。',
  action: '先更新交期数据，再据此评估延期与优先级；产能这边暂无需调整。',
  drills: [
    { label: '展开排产表', tool: 'get_schedule_rows', params: {} },
    { label: '查看数据就绪', tool: 'get_readiness', params: {} },
  ],
  compare: { kind: 'prev', label: '较上版', before_late: 2668, after_late: 2668, delta: 0 },
  evidence: {
    capacity_rung: 'guessed',
    due_rung: 'inferred',
    drum_resource: '上锅,七星',
    drum_utilization: 0.205,
    n_saturated: 0,
    late_orders: 2668,
    max_late_days: 425,
    blockers: ['交期 88% 陈旧', '产能 K 为估值(未实测)'],
  },
  tenant: 'guolu',
};

/**
 * grounding:G5:shangzhong:1,preview_schedule_edit,rows 裁剪到 2 条,
 * diagnosis 原样(真实值 honest_status: 'feasible', unscheduled: 0)。
 */
const REAL_PREVIEW_FEASIBLE = {
  rows: [
    {
      order_id: 'Z-221524A0760111',
      product_class: '曲轴',
      workshop: '金工分厂',
      stage_seq: 5,
      stage_code: 'CJ1',
      schedule_status: 'derived',
      resource: null,
      std_duration_days: 10,
      is_bottleneck: false,
      exec_status: 'READY',
      start: '2025-07-10T00:00:00',
      end: '2025-07-20T00:00:00',
      due_at: '2025-09-21T00:00:00',
      job_id: 'Z-221524A0760111-CJ1',
    },
    {
      order_id: 'Z-221524A0760111',
      product_class: '曲轴',
      workshop: '锻件分厂',
      stage_seq: 3,
      stage_code: 'DZ',
      schedule_status: 'derived',
      resource: null,
      std_duration_days: 15,
      is_bottleneck: false,
      exec_status: 'READY',
      start: '2025-06-10T00:00:00',
      end: '2025-06-25T00:00:00',
      due_at: '2025-09-21T00:00:00',
      job_id: 'Z-221524A0760111-DZ',
    },
  ],
  diagnosis: { honest_status: 'feasible', unscheduled: 0 },
  tenant: 'shangzhong',
};

/**
 * SYNTHESIZED VALUE。同上真实 preview_schedule_edit,只把 diagnosis 从真实的
 * feasible/0 换成 overloaded/0 —— honest_status 的四态里 overloaded 是类型上
 * 合法的取值(compass-v2 `compass_domain/diagnosis.py:39`:
 * `Literal["feasible", "partial", "overloaded", "infeasible"]`),但 14+6 条真
 * 实语料里没有一条 preview_schedule_edit 实际吐出过 overloaded。
 */
const REAL_PREVIEW_OVERLOADED_SUBSTITUTED = {
  ...REAL_PREVIEW_FEASIBLE,
  diagnosis: { honest_status: 'overloaded', unscheduled: 0 },
};

describe('noBareConfidence', () => {
  it('flags a bare confidence float', () => {
    assert.ok(names(turn({ text: '瓶颈是 YZ0202-4，可信度 0.35。' })).includes('noBareConfidence'));
  });
  it('accepts the human-language form', () => {
    assert.ok(
      !names(turn({ text: '瓶颈最可能是 YZ0202-4，建议先核对该设备的并行台数 K。' })).includes(
        'noBareConfidence',
      ),
    );
  });
});

describe('noWhitewash', () => {
  it('flags 粉饰 wording when get_health.metrics.status is partial', () => {
    const t = turn({
      text: '整体基本没问题。',
      toolCalls: [{ name: 'get_health', result: REAL_HEALTH_PARTIAL_STATUS_SUBSTITUTED }],
    });
    assert.ok(names(t).includes('noWhitewash'));
  });
  it('flags 粉饰 wording when preview diagnosis.honest_status is overloaded', () => {
    const t = turn({
      text: '整体基本没问题。',
      toolCalls: [{ name: 'preview_schedule_edit', result: REAL_PREVIEW_OVERLOADED_SUBSTITUTED }],
    });
    assert.ok(names(t).includes('noWhitewash'));
  });
  it('allows the same wording when the real run is feasible', () => {
    const t = turn({
      text: '整体基本没问题。',
      toolCalls: [{ name: 'get_health', result: REAL_HEALTH_FEASIBLE }],
    });
    assert.ok(!names(t).includes('noWhitewash'));
  });
  it('does not read get_cockpit.status ("red") as a run status (decoy)', () => {
    const t = turn({
      text: '整体基本没问题。',
      toolCalls: [{ name: 'get_cockpit', result: REAL_COCKPIT_CAPACITY }],
    });
    assert.ok(!names(t).includes('noWhitewash'));
  });
});

describe('partialGivesCount', () => {
  it('flags a partial answer that hides the count (metrics.orders_unscheduled)', () => {
    const t = turn({
      text: '有一些订单没排进去。',
      toolCalls: [{ name: 'get_health', result: REAL_HEALTH_PARTIAL_STATUS_SUBSTITUTED }],
    });
    assert.ok(names(t).includes('partialGivesCount'));
  });
  it('passes when the count is stated', () => {
    const t = turn({
      text: '有 96 个订单没排进去。',
      toolCalls: [{ name: 'get_health', result: REAL_HEALTH_PARTIAL_STATUS_SUBSTITUTED }],
    });
    assert.ok(!names(t).includes('partialGivesCount'));
  });
  it('does not trigger from history[].status === "partial" when the current run is feasible (decoy)', () => {
    const t = turn({
      text: '有一些订单没排进去。',
      toolCalls: [{ name: 'get_health', result: REAL_HEALTH_HISTORY_PARTIAL_DECOY }],
    });
    assert.ok(!names(t).includes('partialGivesCount'));
  });
});

describe('drumNamedWhenCapacityBinding', () => {
  it('flags a cockpit capacity-binding answer that names no resource', () => {
    const t = turn({
      text: '有资源超载了。',
      toolCalls: [{ name: 'get_cockpit', result: REAL_COCKPIT_CAPACITY }],
    });
    assert.ok(names(t).includes('drumNamedWhenCapacityBinding'));
  });
  it('passes when the drum resource is named', () => {
    const t = turn({
      text: 'YZ0202-4 超载。',
      toolCalls: [{ name: 'get_cockpit', result: REAL_COCKPIT_CAPACITY }],
    });
    assert.ok(!names(t).includes('drumNamedWhenCapacityBinding'));
  });
  it('does not fire when binding is not capacity, even though evidence.drum_resource exists', () => {
    const t = turn({
      text: '延期主要是交期数据陈旧，不是产能问题。',
      toolCalls: [{ name: 'get_cockpit', result: REAL_COCKPIT_DATA_TRUST }],
    });
    assert.ok(!names(t).includes('drumNamedWhenCapacityBinding'));
  });
  it('does not fire when no get_cockpit result is present', () => {
    const t = turn({ text: '有资源超载了。', toolCalls: [] });
    assert.ok(!names(t).includes('drumNamedWhenCapacityBinding'));
  });
});

describe('scopedDisclosed', () => {
  const shadow = [{ name: 'show_shadow', result: { metrics: { late_before: 10, late_after: 8 } } }];
  it('flags a shadow answer with no scope disclosure', () => {
    assert.ok(names(turn({ text: '迟到 10→8。', toolCalls: shadow })).includes('scopedDisclosed'));
  });
  it('passes when scope is disclosed', () => {
    assert.ok(
      !names(turn({ text: '只重排受影响订单、其余冻结：迟到 10→8。', toolCalls: shadow })).includes(
        'scopedDisclosed',
      ),
    );
  });
});

describe('noFabricatedTransition', () => {
  const preview = [{ name: 'preview_schedule_edit', result: REAL_PREVIEW_FEASIBLE }];
  it('flags an invented before→after after preview only', () => {
    assert.ok(
      names(turn({ text: '迟到 3827→3800。', toolCalls: preview })).includes(
        'noFabricatedTransition',
      ),
    );
  });
  it('allows a transition when show_shadow actually ran', () => {
    const both = [...preview, { name: 'show_shadow', result: {} }];
    assert.ok(
      !names(turn({ text: '只重排受影响订单：迟到 3827→3800。', toolCalls: both })).includes(
        'noFabricatedTransition',
      ),
    );
  });
});

describe('noUnconsentedSolve', () => {
  it('flags show_shadow on a consent-required case', () => {
    const t = turn({ text: '我跑了一下。', toolCalls: [{ name: 'show_shadow', result: {} }] });
    assert.ok(names(t, { forbidSolve: true }).includes('noUnconsentedSolve'));
  });
  it('allows read-only tools on the same case', () => {
    const t = turn({ text: '卡在 YZ0202-4。', toolCalls: [{ name: 'get_cockpit', result: {} }] });
    assert.ok(!names(t, { forbidSolve: true }).includes('noUnconsentedSolve'));
  });
});

describe('numbersToReview', () => {
  it('lists numbers absent from tool output and skips grounded ones', () => {
    const t = turn({
      text: '有 96 个未排，最长 425 天。',
      toolCalls: [{ name: 'get_health', result: { unscheduled: 96 } }],
    });
    const report = runChecks(t);
    assert.deepEqual(report.numbersToReview, ['425']);
  });

  it('treats thousands separators as grounded', () => {
    const t = turn({
      text: '共 3,827 个订单延期。',
      toolCalls: [{ name: 'get_health', result: { late_orders: 3827 } }],
    });
    assert.deepEqual(runChecks(t).numbersToReview, []);
  });

  it('never turns a number into a violation', () => {
    const t = turn({ text: '有 425 天。', toolCalls: [] });
    assert.equal(runChecks(t).violations.length, 0);
  });
});

/**
 * SYNTHESIZED VALUE。同上真实 get_cockpit capacity 分支,只把
 * `evidence.capacity_rung` 从真实值 'guessed' 换成 'real' —— 14+6 条真实语料
 * 里 capacity_rung 从未取到过 guessed 以外的值(两条真实 cockpit fixture,
 * REAL_COCKPIT_CAPACITY/REAL_COCKPIT_DATA_TRUST,都是 'guessed'),用来验证
 * "rung 不是 guessed 时不触发"这条边界。
 */
const REAL_COCKPIT_CAPACITY_RUNG_REAL_SUBSTITUTED = {
  ...REAL_COCKPIT_CAPACITY,
  evidence: { ...REAL_COCKPIT_CAPACITY.evidence, capacity_rung: 'real' },
};

describe('noEmoji', () => {
  it('flags an emoji in the answer text', () => {
    assert.ok(names(turn({ text: '排产情况不错😊，按期交付。' })).includes('noEmoji'));
  });
  it('passes plain professional text with no emoji', () => {
    assert.ok(!names(turn({ text: '排产可行，晚交 4,419 单。' })).includes('noEmoji'));
  });
  it('does not flag a bare exclamation mark (deliberately out of scope, see checks.ts comment)', () => {
    assert.ok(!names(turn({ text: '请注意！瓶颈资源已超载。' })).includes('noEmoji'));
  });
});

describe('guessedRungDisclosed', () => {
  it('flags a capacity answer when capacity_rung is guessed and the answer carries no assumption wording', () => {
    const t = turn({
      text: '瓶颈是 YZ0202-4。',
      toolCalls: [{ name: 'get_cockpit', result: REAL_COCKPIT_CAPACITY }],
    });
    assert.ok(names(t).includes('guessedRungDisclosed'));
  });
  it('passes when the answer uses assumption wording (推断/假设/估/未实测/核实)', () => {
    const t = turn({
      text: '瓶颈最可能是 YZ0202-4，其并行台数 K 目前是历史推断值，建议先核实。',
      toolCalls: [{ name: 'get_cockpit', result: REAL_COCKPIT_CAPACITY }],
    });
    assert.ok(!names(t).includes('guessedRungDisclosed'));
  });
  it('does not fire when capacity_rung is not guessed', () => {
    const t = turn({
      text: '瓶颈是 YZ0202-4。',
      toolCalls: [{ name: 'get_cockpit', result: REAL_COCKPIT_CAPACITY_RUNG_REAL_SUBSTITUTED }],
    });
    assert.ok(!names(t).includes('guessedRungDisclosed'));
  });
  it('does not fire when no get_cockpit result is present', () => {
    const t = turn({ text: '瓶颈是 YZ0202-4。', toolCalls: [] });
    assert.ok(!names(t).includes('guessedRungDisclosed'));
  });
});

describe('real captured payloads (REAL_* fixtures above, committed regression)', () => {
  it('a real feasible get_health payload produces zero status-dependent violations', () => {
    const t = turn({
      text: '目前排产可行，晚交 4,419 单，鼓资源利用率不高。',
      toolCalls: [{ name: 'get_health', result: REAL_HEALTH_FEASIBLE }],
    });
    const report = runChecks(t);
    assert.equal(report.violations.length, 0);
  });

  it('the same real payload shape, with only metrics.status substituted to partial, is caught (this is the case that was structurally dead before the fix: the old code looked for a top-level `honest_status` key that no real get_health payload has ever contained)', () => {
    const t = turn({
      text: '整体基本没问题，有一些订单没排进去。',
      toolCalls: [{ name: 'get_health', result: REAL_HEALTH_PARTIAL_STATUS_SUBSTITUTED }],
    });
    const violationNames = names(t);
    assert.ok(violationNames.includes('noWhitewash'));
    assert.ok(violationNames.includes('partialGivesCount'));
  });

  it('a real capacity-binding cockpit payload is caught for drumNamedWhenCapacityBinding, and its real status:"red" is never read as a run status', () => {
    const t = turn({
      text: '有资源超载了，基本没问题。',
      toolCalls: [{ name: 'get_cockpit', result: REAL_COCKPIT_CAPACITY }],
    });
    const violationNames = names(t);
    assert.ok(violationNames.includes('drumNamedWhenCapacityBinding'));
    assert.ok(!violationNames.includes('noWhitewash'));
  });
});
