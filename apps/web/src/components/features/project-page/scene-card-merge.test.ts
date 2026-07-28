import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildMergedRows,
  canMergeCards,
  extractDisplayRows,
  extractNarrative,
  readCardPayload,
  rowDiff,
  type DisplayRow,
  type MergedCell,
} from './scene-card-merge';

/** Contract rows, written the way a capability server ships them. The keys are
 * opaque strings to this module — the tests use compass-shaped ones only
 * because they are realistic, never because the code knows them. */
const row = (key: string, section: string, label: string, value: string, num?: number): DisplayRow =>
  num === undefined ? { key, section, label, value } : { key, section, label, value, num };

describe('scene-card-merge / payload extraction', () => {
  it('reads the card from structuredContent, the text channel, or a bare object', () => {
    const card = { display: [row('a.b', 'S', 'L', 'v')] };
    assert.deepEqual(readCardPayload({ structuredContent: card, content: [] }), card);
    assert.deepEqual(
      readCardPayload({ content: [{ type: 'text', text: JSON.stringify(card) }] }),
      card,
    );
    assert.deepEqual(readCardPayload(card), card);
  });

  it('non-objects and unparseable text yield no rows (fallback, never a guess)', () => {
    assert.equal(readCardPayload(null), null);
    assert.equal(readCardPayload('nope'), null);
    assert.equal(extractDisplayRows({ content: [{ type: 'text', text: 'not json' }] }), null);
    assert.equal(extractDisplayRows({ some: 'card', but: 'no display' }), null);
    assert.equal(extractDisplayRows(undefined), null);
  });

  it('extracts contract rows, drops malformed ones and duplicate keys', () => {
    const rows = extractDisplayRows({
      display: [
        row('problem.orders', '问题结构', '订单', '7,088', 7088),
        { key: 'bad.missing.value', section: 'S', label: 'L' },
        { key: 'bad.num', section: 'S', label: 'L', value: 'x', num: 'twelve' },
        row('problem.orders', '问题结构', '订单(dupe)', '9'),
        row('honesty.real', '数据诚实度', '真实', '80%', 80),
      ],
    });
    assert.deepEqual(
      rows?.map((r) => r.key),
      ['problem.orders', 'honesty.real'],
    );
    assert.equal(rows?.[0]?.label, '订单'); // first occurrence wins
  });

  it('an empty display array counts as no display (⇒ fallback)', () => {
    assert.equal(extractDisplayRows({ display: [] }), null);
    assert.equal(extractDisplayRows({ display: [{ nonsense: true }] }), null);
  });
});

describe('scene-card-merge / narrative extraction', () => {
  it('takes the text and its timestamp when the card has prose', () => {
    assert.deepEqual(
      extractNarrative('guolu', {
        structuredContent: { narrative: { text: '本场景以二级排产为主。', generated_at: '2026-07-27T08:00:00Z' } },
      }),
      { source: 'guolu', text: '本场景以二级排产为主。', generatedAt: '2026-07-27T08:00:00Z' },
    );
  });

  it('pending / unavailable / absent narratives yield nothing (no placeholder)', () => {
    assert.equal(extractNarrative('guolu', { narrative: { status: 'pending' } }), null);
    assert.equal(extractNarrative('guolu', { narrative: { status: 'unavailable' } }), null);
    assert.equal(extractNarrative('guolu', { narrative: { text: '   ' } }), null);
    assert.equal(extractNarrative('guolu', { display: [] }), null);
    assert.equal(extractNarrative('guolu', null), null);
  });
});

describe('scene-card-merge / fallback gate', () => {
  const rows = [row('a', 'S', 'L', 'v')];
  const card = (source: string, r: DisplayRow[] | null = rows) => ({ source, rows: r });

  it('needs more than one scene', () => {
    assert.equal(canMergeCards([card('guolu')]), false);
    assert.equal(canMergeCards([]), false);
    assert.equal(canMergeCards([card('guolu'), card('shangzhong')]), true);
  });

  it('several cards of the SAME scene are not a comparison', () => {
    // e.g. two capability servers both answering for one source.
    assert.equal(canMergeCards([card('guolu'), card('guolu')]), false);
  });

  it('ANY card without display ⇒ no merge (no partial comparison)', () => {
    assert.equal(canMergeCards([card('guolu'), card('shangzhong', null)]), false);
    assert.equal(canMergeCards([card('guolu', null), card('shangzhong', null)]), false);
    assert.equal(canMergeCards([card('guolu'), card('shangzhong', [])]), false);
    assert.equal(canMergeCards([card('a'), card('b'), card('c', null)]), false);
  });
});

describe('scene-card-merge / buildMergedRows', () => {
  const guolu = {
    source: 'guolu',
    rows: [
      row('problem.orders', '问题结构', '订单', '7,088', 7088),
      row('capacity.tonnage.上锅', '产能口径', '上锅', '1,200 吨/月', 1200),
      row('honesty.real', '数据诚实度', '真实', '80%', 80),
    ],
  };
  const shangzhong = {
    source: 'shangzhong',
    rows: [
      row('problem.orders', '问题结构', '订单', '30,923', 30923),
      row('problem.jobs', '问题结构', '工序', '30,923', 30923),
      row('honesty.real', '数据诚实度', '真实', '60%', 60),
      row('rules.active', '规则健康', '生效规则', '12', 12),
    ],
  };

  it('rows are the key union in first-card order, newcomers appended', () => {
    const sections = buildMergedRows([guolu, shangzhong]);
    assert.deepEqual(
      sections.flatMap((s) => s.rows.map((r) => r.key)),
      [
        'problem.orders',
        'problem.jobs', // newcomer, appended inside its section
        'capacity.tonnage.上锅',
        'honesty.real',
        'rules.active',
      ],
    );
  });

  it('groups by the payload-supplied section, in first-appearance order', () => {
    const sections = buildMergedRows([guolu, shangzhong]);
    assert.deepEqual(
      sections.map((s) => s.section),
      ['问题结构', '产能口径', '数据诚实度', '规则健康'],
    );
  });

  it('a scene that lacks a row gets an explicit missing cell, not a blank', () => {
    const sections = buildMergedRows([guolu, shangzhong]);
    const cells = (key: string) =>
      sections.flatMap((s) => s.rows).find((r) => r.key === key)?.cells;
    assert.deepEqual(cells('capacity.tonnage.上锅'), [{ value: '1,200 吨/月', num: 1200 }, null]);
    assert.deepEqual(cells('rules.active'), [null, { value: '12', num: 12 }]);
  });

  it('label and section come from the first scene that carries the key', () => {
    const a = { source: 'a', rows: [row('k', 'S1', 'Label A', '1')] };
    const b = { source: 'b', rows: [row('k', 'S2', 'Label B', '2')] };
    const sections = buildMergedRows([a, b]);
    assert.equal(sections.length, 1);
    assert.equal(sections[0]?.section, 'S1');
    assert.equal(sections[0]?.rows[0]?.label, 'Label A');
  });

  it('column order follows the given scene order', () => {
    const [flipped] = buildMergedRows([shangzhong, guolu]);
    assert.deepEqual(flipped?.rows[0]?.cells, [
      { value: '30,923', num: 30923 },
      { value: '7,088', num: 7088 },
    ]);
  });

  it('carries the per-row diff decision', () => {
    const sections = buildMergedRows([guolu, shangzhong]);
    const orders = sections[0]?.rows[0];
    assert.equal(orders?.diff.kind, 'numeric');
    // A key only one scene has cannot differ.
    const only = sections.flatMap((s) => s.rows).find((r) => r.key === 'rules.active');
    assert.deepEqual(only?.diff, { kind: 'none' });
  });

  it('a single scene merges to itself with no highlight anywhere', () => {
    const sections = buildMergedRows([guolu]);
    assert.deepEqual(
      sections.flatMap((s) => s.rows).map((r) => r.diff.kind),
      ['none', 'none', 'none'],
    );
  });
});

describe('scene-card-merge / rowDiff', () => {
  const cell = (value: string, num?: number): MergedCell =>
    num === undefined ? { value } : { value, num };

  it('all-numeric cells shade by min-max position, max = 1', () => {
    const diff = rowDiff([cell('10', 10), cell('20', 20), cell('15', 15)]);
    assert.deepEqual(diff, { kind: 'numeric', intensity: [0, 1, 0.5] });
  });

  it('missing cells carry no intensity but do not break the scale', () => {
    const diff = rowDiff([cell('4', 4), null, cell('8', 8)]);
    assert.deepEqual(diff, { kind: 'numeric', intensity: [0, null, 1] });
  });

  it('identical numbers ⇒ no highlight', () => {
    assert.deepEqual(rowDiff([cell('5', 5), cell('5', 5)]), { kind: 'none' });
    // Same number, different display strings — the numbers decide.
    assert.deepEqual(rowDiff([cell('5', 5), cell('5.0', 5)]), { kind: 'none' });
  });

  it('any cell without a number falls back to string comparison', () => {
    assert.deepEqual(rowDiff([cell('高', 3), cell('未知')]), { kind: 'differs' });
    assert.deepEqual(rowDiff([cell('真实'), cell('推断')]), { kind: 'differs' });
  });

  it('identical strings ⇒ no highlight', () => {
    assert.deepEqual(rowDiff([cell('已声明'), cell('已声明'), cell('已声明')]), { kind: 'none' });
  });

  it('fewer than two present cells ⇒ nothing to compare', () => {
    assert.deepEqual(rowDiff([cell('7', 7), null]), { kind: 'none' });
    assert.deepEqual(rowDiff([cell('7', 7)]), { kind: 'none' });
    assert.deepEqual(rowDiff([null, null]), { kind: 'none' });
  });
});
