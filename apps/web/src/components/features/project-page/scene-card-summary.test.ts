import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DisplayRow } from './scene-card-merge';
import {
  buildNumMap,
  checkupVerdict,
  computeDeltas,
  computeTrustScore,
  extractAttentionItems,
  extractCapacityBars,
  extractCapacityTruncated,
  extractHonestySegments,
  extractJudgmentPositives,
  extractRulesHitRate,
  formatMeasure,
  formatRowValue,
  groupDisplayBySection,
  groupSectionsByTab,
  isProseFact,
  pickGlanceChanges,
  pickKeyMetrics,
  recommendationKey,
  remainingDisplayRows,
  truncateNarrative,
} from './scene-card-summary';

const row = (
  key: string,
  section: string,
  label: string,
  value: string,
  num?: number,
): DisplayRow =>
  num === undefined ? { key, section, label, value } : { key, section, label, value, num };

describe('pickKeyMetrics', () => {
  it('prefers 订单 / 二级 / 三级 / 有效规则 as heroes', () => {
    const rows = [
      row('honesty.guess', '数据诚实度', '猜测', '80%', 80),
      row('problem.orders', '问题结构', '订单', '4,601', 4601),
      row('problem.l2', '问题结构', '二级工序', '30,923', 30923),
      row('problem.l3', '问题结构', '三级工序', '23,348', 23348),
      row('rules.active', '规则健康', '有效规则', '96 条', 96),
      row('cap.k', '产能口径', '并行规则', '94 条', 94),
    ];
    const heroes = pickKeyMetrics(rows);
    assert.deepEqual(
      heroes.map((h) => h.key),
      ['problem.orders', 'problem.l2', 'problem.l3', 'rules.active'],
    );
  });

  it('fills with numeric rows when patterns miss', () => {
    const rows = [
      row('a', 'S', 'A', '1', 1),
      row('b', 'S', 'B', '2', 2),
      row('c', 'S', 'C', 'x'),
    ];
    assert.deepEqual(
      pickKeyMetrics(rows).map((h) => h.key),
      ['a', 'b', 'c'],
    );
  });

  it('returns empty for empty input', () => {
    assert.deepEqual(pickKeyMetrics([]), []);
  });
});

describe('remainingDisplayRows / groupDisplayBySection', () => {
  it('drops hero keys then groups by section order', () => {
    const rows = [
      row('problem.orders', '问题结构', '订单', '1', 1),
      row('cap.k', '产能口径', '并行', '2', 2),
      row('red.l1', '红线', 'L1', '0', 0),
      row('cap.batch', '产能口径', '批次炉', '2', 2),
    ];
    const heroes = pickKeyMetrics(rows, 1);
    const rest = remainingDisplayRows(rows, heroes);
    assert.ok(!rest.some((r) => r.key === 'problem.orders'));
    const groups = groupDisplayBySection(rest);
    assert.deepEqual(
      groups.map((g) => g.section),
      ['产能口径', '红线'],
    );
    assert.equal(groups[0]?.rows.length, 2);
  });
});

describe('truncateNarrative', () => {
  it('leaves short text alone', () => {
    assert.deepEqual(truncateNarrative('短句。'), { text: '短句。', truncated: false });
  });

  it('cuts long prose near a sentence end when possible', () => {
    const long = `${'甲'.repeat(40)}。${'乙'.repeat(100)}`;
    const out = truncateNarrative(long, 50);
    assert.equal(out.truncated, true);
    assert.ok(out.text.endsWith('…'));
    assert.ok(out.text.length < long.length);
  });
});

describe('summary charts from display', () => {
  it('builds honesty segments with tones', () => {
    const segs = extractHonestySegments([
      row('honesty.real', '数据诚实度', '真值', '2 条', 2),
      { ...row('honesty.guessed', '数据诚实度', '猜测', '1 条', 1), tone: 'warning' },
      row('rules.active', '规则健康', '有效', '96 条', 96),
    ]);
    assert.deepEqual(
      segs.map((s) => s.key),
      ['honesty.real', 'honesty.guessed'],
    );
    assert.equal(segs[1]?.tone, 'warning');
  });

  it('ranks capacity K bars and skips truncated filler', () => {
    const bars = extractCapacityBars(
      [
        row('capacity.k.a', '产能口径', 'A', 'K=10', 10),
        row('capacity.k.b', '产能口径', 'B', 'K=80', 80),
        row('capacity.k._truncated', '产能口径', '其余', '另有 3 条', 3),
      ],
      8,
    );
    assert.deepEqual(
      bars.map((b) => b.key),
      ['capacity.k.b', 'capacity.k.a'],
    );
  });

  // 真机 guolu 讲的是吨/月,不是并行台数。写死 `capacity.k.` 前缀会让这张图整个不出,
  // 八个资源(最高的和最低的差近四倍)退化成一列文字。
  it('图也认 K 以外的产能口径,并把单位带出来', () => {
    const bars = extractCapacityBars([
      { key: 'capacity.tonnage.汇能', section: '产能口径', label: '汇能', value: '', num: 6801.2, unit: '吨/月' },
      { key: 'capacity.tonnage.绿叶', section: '产能口径', label: '绿叶', value: '', num: 5167.8, unit: '吨/月' },
      row('capacity.tonnage._truncated', '产能口径', '未显示资源', '另有 44 个', 44),
    ]);
    assert.deepEqual(
      bars.map((b) => b.label),
      ['汇能', '绿叶'],
    );
    assert.equal(bars[0]?.unit, '吨/月');
  });

  it('两种口径不共用一根轴 —— 条长只在同一口径内可比', () => {
    const bars = extractCapacityBars([
      row('capacity.k.a', '产能口径', 'A', 'K=3', 3),
      { key: 'capacity.tonnage.x', section: '产能口径', label: 'X', value: '', num: 900, unit: '吨/月' },
      { key: 'capacity.tonnage.y', section: '产能口径', label: 'Y', value: '', num: 800, unit: '吨/月' },
    ]);
    assert.deepEqual(
      bars.map((b) => b.key),
      ['capacity.tonnage.x', 'capacity.tonnage.y'],
    );
  });

  // 真机上 K 那一口径十个资源全是 1,出图就是十根等长满格条。口径多的那个不一定是
  // 有信息的那个,所以先挑能把资源分开的。
  it('宁可挑行数少但有区分度的口径,也不要全场同一个读数', () => {
    const bars = extractCapacityBars([
      row('capacity.k.a', '产能口径', 'A', 'K=1', 1),
      row('capacity.k.b', '产能口径', 'B', 'K=1', 1),
      row('capacity.k.c', '产能口径', 'C', 'K=1', 1),
      { key: 'capacity.tonnage.x', section: '产能口径', label: 'X', value: '', num: 900, unit: '吨/月' },
      { key: 'capacity.tonnage.y', section: '产能口径', label: 'Y', value: '', num: 200, unit: '吨/月' },
    ]);
    assert.deepEqual(
      bars.map((b) => b.label),
      ['X', 'Y'],
    );
  });

  it('全都没区分度时仍然出图口径,交给图自己去讲', () => {
    const bars = extractCapacityBars([
      row('capacity.k.a', '产能口径', 'A', 'K=1', 1),
      row('capacity.k.b', '产能口径', 'B', 'K=1', 1),
    ]);
    assert.equal(bars.length, 2);
    assert.ok(bars.every((b) => b.num === 1));
  });

  // 截断数和图必须讲同一个口径,否则图上是台数、旁边写着"另有 44 个吨/月资源未显示"。
  it('截断数取自出图的那个口径', () => {
    const rows = [
      { key: 'capacity.tonnage.x', section: '产能口径', label: 'X', value: '', num: 900, unit: '吨/月' },
      { key: 'capacity.tonnage.y', section: '产能口径', label: 'Y', value: '', num: 800, unit: '吨/月' },
      row('capacity.tonnage._truncated', '产能口径', '未显示', '另有 44 个', 44),
      row('capacity.k._truncated', '产能口径', '未显示', '另有 9 个', 9),
    ];
    assert.equal(extractCapacityTruncated(rows), 44);
  });

  it('一条数值行都没有时,截断数仍然报得出来', () => {
    assert.equal(
      extractCapacityTruncated([row('capacity.k._truncated', '产能口径', '未显示', '另有 9 个', 9)]),
      9,
    );
  });

  it('computes rules hit rate or returns null', () => {
    assert.deepEqual(
      extractRulesHitRate([
        row('rules.active', '规则健康', '有效', '96', 96),
        row('rules.hit', '规则健康', '命中', '5', 5),
      ]),
      { active: 96, hit: 5 },
    );
    assert.equal(extractRulesHitRate([row('rules.active', '规则健康', '有效', '96', 96)]), null);
  });
});

describe('formatMeasure / formatRowValue', () => {
  it('解算器浮点不原样上屏', () => {
    const m = formatMeasure(6801.249999999997);
    assert.ok(!/249999/.test(m), m);
    assert.ok(/6.?801/.test(m), m);
  });

  it('整数不长出小数位,小数留两位', () => {
    assert.match(formatMeasure(2451), /^2.?451$/);
    assert.match(formatMeasure(3.456), /^3[.,]46$/);
  });

  it('只重写行首那个数,单位和口径说明留着', () => {
    const cleaned = formatRowValue({
      key: 'capacity.tonnage.汇能',
      section: '产能口径',
      label: '汇能',
      value: '6801.249999999997 吨/月(多规则取最大)',
      num: 6801.249999999997,
    });
    assert.ok(!/249999/.test(cleaned), cleaned);
    assert.ok(cleaned.endsWith(' 吨/月(多规则取最大)'), cleaned);
  });

  it('value 不是以那个数打头就不碰它', () => {
    const untouched = formatRowValue(row('rules.hit', '规则健康', '命中', '命中 99 条', 99));
    assert.equal(untouched, '命中 99 条');
  });
});

// 「标签 ——— 数值」那个行型里,右值不收缩、左标签 truncate,所以长文本会把标签挤没。
// 真机上红线的 effect 有 200 字,实物截图里规则名整个不见了。
describe('isProseFact', () => {
  const redLine = {
    key: 'red_lines.r1',
    section: '红线',
    label: 'classless 外协 fallback (priority 10, only catches classes with no per-class rule)',
    value:
      '吨/月 (monthly_weight) · 上锅, 东方热能, 中科, 华益, 四方, 山东博宇, 德海, 德耐特, 招标, 新桠欣, 杭州杭富',
  };

  it('长的定性文本走通栏,不跟标签挤一行', () => {
    assert.equal(isProseFact(redLine, redLine.value), true);
  });

  it('数值行照旧「标签 ——— 数值」', () => {
    assert.equal(isProseFact(row('rules.hit', '规则健康', '上次命中', '319 条', 319), '319 条'), false);
  });

  it('短的文字值也照旧 —— 通栏是给长文本的,不是给所有非数值', () => {
    assert.equal(isProseFact(row('problem.levels', '问题结构', '层级', '二级'), '二级'), false);
    assert.equal(isProseFact(row('rules.changed', '规则健康', '规则集自上次排产', '未变'), '未变'), false);
  });
});

describe('visit deltas', () => {
  it('diffs only shared keys that changed', () => {
    const current = buildNumMap([
      row('problem.orders', 'S', '订单', '100', 100),
      row('rules.hit', 'S', '命中', '5', 5),
    ]);
    assert.deepEqual(computeDeltas(current, { 'problem.orders': 90, 'rules.hit': 5 }), {
      'problem.orders': 10,
    });
    assert.deepEqual(computeDeltas(current, null), {});
  });
});

describe('trust / attention / detail tabs', () => {
  it('scores honesty breakdown without inventing segments', () => {
    const trust = computeTrustScore([
      { key: 'honesty.real', label: '真值', num: 2 },
      { key: 'honesty.inferred', label: '推断', num: 2 },
      { key: 'honesty.guess', label: '猜测', num: 1 },
      { key: 'honesty.missing', label: '缺失', num: 1 },
    ]);
    assert.equal(trust?.score, 81);
    assert.equal(trust?.band, 'usable');
    assert.equal(computeTrustScore([]), null);
  });

  it('surfaces decision-facing attention items', () => {
    const rows = [
      row('rules.active', '规则健康', '有效', '96', 96),
      row('rules.hit', '规则健康', '命中', '5', 5),
      row('capacity.k._truncated', '产能口径', '其余', '另有 3 个', 3),
      row('cap.furnace', '产能口径', '拼炉规则', '2 条', 2),
      row('honesty.missing', '数据诚实度', '缺失', '1 项', 1),
    ];
    const honesty = extractHonestySegments(rows);
    const rules = extractRulesHitRate(rows);
    const truncated = extractCapacityTruncated(rows);
    assert.equal(truncated, 3);
    const items = extractAttentionItems(rows, honesty, rules, truncated);
    assert.deepEqual(
      items.map((i) => i.id),
      ['rules-hit-low', 'honesty-missing', 'capacity-truncated', 'furnace-rules'],
    );
  });

  it('buckets sections into detail tabs', () => {
    const groups = groupSectionsByTab([
      { section: '问题结构', rows: [row('a', '问题结构', 'A', '1', 1)] },
      { section: '产能口径', rows: [row('b', '产能口径', 'B', '2', 2)] },
      { section: '规则健康', rows: [row('c', '规则健康', 'C', '3', 3)] },
      { section: '其它来源', rows: [row('d', '其它来源', 'D', '4', 4)] },
    ]);
    assert.deepEqual(
      groups.map((g) => g.tab),
      ['data', 'capacity', 'rules', 'other'],
    );
  });

  /** 红线是最硬的那类规则,归「其它」等于把硬约束埋在杂项里。文案在 i18n 的
   *  projectPage.redLineSection,和 tabForSection 的正则是一对。 */
  it('红线归「规则」页,不落进「其它」', () => {
    const groups = groupSectionsByTab([
      { section: '红线规则 L1', rows: [row('red_lines.r1', '红线规则 L1', '某红线', '吨/月')] },
      { section: '其它来源', rows: [row('d', '其它来源', 'D', '4', 4)] },
    ]);
    assert.deepEqual(
      groups.map((g) => g.tab),
      ['rules', 'other'],
    );
  });

  it('builds AI verdict / positives / recommendation', () => {
    const trust = computeTrustScore([
      { key: 'honesty.real', label: '真值', num: 2 },
      { key: 'honesty.inferred', label: '推断', num: 2 },
      { key: 'honesty.guess', label: '猜测', num: 1 },
      { key: 'honesty.missing', label: '缺失', num: 1 },
    ]);
    assert.deepEqual(checkupVerdict(trust, 3), {
      key: 'verdictUsableWithIssues',
      params: { count: 3 },
    });
    assert.equal(recommendationKey(trust, 3), 'recommendFixFirst');
    const positives = extractJudgmentPositives(
      [
        row('problem.orders', '问题结构', '订单', '1', 1),
        row('problem.l2', '问题结构', '二级', '2', 2),
        row('problem.l3', '问题结构', '三级', '3', 3),
      ],
      [
        { key: 'capacity.k.a', label: 'A', num: 150 },
        { key: 'capacity.k.b', label: 'B', num: 150 },
        { key: 'capacity.k.c', label: 'C', num: 80 },
      ],
    );
    assert.deepEqual(
      positives.map((p) => p.id),
      ['scale', 'capacity'],
    );
  });
});

describe('pickGlanceChanges', () => {
  it('returns nothing on first visit', () => {
    const heroes = [row('problem.orders', '问题结构', '订单', '4,601', 4601)];
    assert.deepEqual(pickGlanceChanges(heroes, { 'problem.orders': 12 }, false), []);
  });

  it('lists changed heroes before unchanged', () => {
    const heroes = [
      row('problem.orders', '问题结构', '订单', '4,601', 4601),
      row('problem.l2', '问题结构', '二级工序', '30,923', 30923),
      row('rules.active', '规则健康', '有效规则', '96 条', 96),
    ];
    assert.deepEqual(pickGlanceChanges(heroes, { 'rules.active': -2 }, true), [
      { label: '有效规则', delta: -2 },
      { label: '订单', delta: 0 },
      { label: '二级工序', delta: 0 },
    ]);
  });
});
