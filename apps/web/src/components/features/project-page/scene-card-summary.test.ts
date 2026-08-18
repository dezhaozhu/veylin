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
  groupDisplayBySection,
  groupSectionsByTab,
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
