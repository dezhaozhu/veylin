import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildMergedRows,
  canMergeCards,
  extractDisplayRows,
  extractNarrative,
  partitionSectionRows,
  readCardPayload,
  rowDiff,
  type DisplayRow,
  type MergedCell,
  type MergedRow,
} from './scene-card-merge';
import { fetchSceneCard, type SceneCardSpec } from './use-scene-card-payloads';

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

  it('a row naming no section is dropped (it would render a blank group header)', () => {
    const rows = extractDisplayRows({
      display: [
        { key: 'no.section', section: '', label: 'L', value: 'v' },
        { key: 'blank.section', section: '   ', label: 'L', value: 'v' },
        row('ok', 'S', 'L', 'v'),
      ],
    });
    assert.deepEqual(
      rows?.map((r) => r.key),
      ['ok'],
    );
    // A card whose ONLY rows lack a section carries no display at all.
    assert.equal(extractDisplayRows({ display: [{ key: 'k', section: '', label: 'L', value: 'v' }] }), null);
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

describe('scene-card-merge / shared vs partial rows (the dash wall)', () => {
  const mk = (key: string, cells: MergedCell[]): MergedRow => ({
    key,
    label: key,
    cells,
    diff: { kind: 'none' },
  });
  const v = (value: string): MergedCell => ({ value });

  it('rows every scene has are shared; rows only some have are partial', () => {
    const { shared, partial } = partitionSectionRows([
      mk('both', [v('1'), v('2')]),
      mk('left-only', [v('1'), null]),
      mk('right-only', [null, v('2')]),
    ]);
    assert.deepEqual(shared.map((r) => r.key), ['both']);
    assert.deepEqual(partial.map((r) => r.key), ['left-only', 'right-only']);
  });

  it('all-shared ⇒ nothing to collapse (a section with no disclosure)', () => {
    const { shared, partial } = partitionSectionRows([
      mk('a', [v('1'), v('2')]),
      mk('b', [v('3'), v('4')]),
    ]);
    assert.equal(shared.length, 2);
    assert.deepEqual(partial, []);
  });

  it('all-partial ⇒ everything collapses (a section that is only a disclosure)', () => {
    const { shared, partial } = partitionSectionRows([
      mk('a', [v('1'), null]),
      mk('b', [null, v('2')]),
    ]);
    assert.deepEqual(shared, []);
    assert.equal(partial.length, 2);
  });

  it('original order is preserved WITHIN each group', () => {
    const { shared, partial } = partitionSectionRows([
      mk('s1', [v('1'), v('2')]),
      mk('p1', [v('1'), null]),
      mk('s2', [v('3'), v('4')]),
      mk('p2', [null, v('2')]),
      mk('s3', [v('5'), v('6')]),
    ]);
    assert.deepEqual(shared.map((r) => r.key), ['s1', 's2', 's3']);
    assert.deepEqual(partial.map((r) => r.key), ['p1', 'p2']);
  });

  it('presence is the only criterion — no key or section is consulted', () => {
    // Two rows with identical keys-shapes but different presence land in
    // different groups; a per-entity key that DOES intersect stays shared.
    const { shared, partial } = partitionSectionRows([
      mk('capacity.tonnage.上锅', [v('1,200 吨/月'), v('2,646 吨/月')]),
      mk('capacity.tonnage.YZ0202-4', [null, v('900 吨/月')]),
    ]);
    assert.deepEqual(shared.map((r) => r.key), ['capacity.tonnage.上锅']);
    assert.deepEqual(partial.map((r) => r.key), ['capacity.tonnage.YZ0202-4']);
  });

  it('a section straight out of buildMergedRows partitions as rendered', () => {
    const a = { source: 'a', rows: [row('shared', 'S', 'Shared', '1', 1), row('only-a', 'S', 'A', '2', 2)] };
    const b = { source: 'b', rows: [row('shared', 'S', 'Shared', '9', 9)] };
    const [section] = buildMergedRows([a, b]);
    const { shared, partial } = partitionSectionRows(section!.rows);
    assert.deepEqual(shared.map((r) => r.key), ['shared']);
    assert.deepEqual(partial.map((r) => r.key), ['only-a']);
  });
});

describe('scene-card-merge / multi-scene × multi-server (4 columns)', () => {
  // Two sources × two capability servers: the page fetches one card per
  // (source, server) pair, so the SAME source appears in two columns.
  const card = (label: string, orders: number, extra?: DisplayRow) => ({
    rows: [row('problem.orders', '问题结构', '订单', String(orders), orders), ...(extra ? [extra] : [])],
    label,
  });
  const scenes = [
    { source: 'guolu', ...card('guolu/alpha', 7088) },
    { source: 'guolu', ...card('guolu/beta', 7088, row('beta.only', '扩展', 'Beta', 'x')) },
    { source: 'shangzhong', ...card('shangzhong/alpha', 30923) },
    { source: 'shangzhong', ...card('shangzhong/beta', 30923) },
  ];

  it('merges into one row per key with one cell per COLUMN, not per source', () => {
    const sections = buildMergedRows(scenes);
    const orders = sections[0]?.rows[0];
    assert.equal(orders?.key, 'problem.orders');
    assert.deepEqual(orders?.cells, [
      { value: '7088', num: 7088 },
      { value: '7088', num: 7088 },
      { value: '30923', num: 30923 },
      { value: '30923', num: 30923 },
    ]);
  });

  it('the two columns of one source stay distinct — no key collision', () => {
    const sections = buildMergedRows(scenes);
    const betaOnly = sections.flatMap((s) => s.rows).find((r) => r.key === 'beta.only');
    // Present in guolu/beta only: column 1, not column 0, even though both
    // columns are the SAME source.
    assert.deepEqual(betaOnly?.cells, [null, { value: 'x' }, null, null]);
    assert.deepEqual(partitionSectionRows([betaOnly!]).partial.map((r) => r.key), ['beta.only']);
  });

  it('duplicate sources still count as a comparison (2 distinct scenes)', () => {
    assert.equal(
      canMergeCards(scenes.map((s) => ({ source: s.source, rows: s.rows }))),
      true,
    );
  });

  it('a numeric row shades per column, so identical siblings shade identically', () => {
    const sections = buildMergedRows(scenes);
    assert.deepEqual(sections[0]?.rows[0]?.diff, {
      kind: 'numeric',
      intensity: [0, 0, 1, 1],
    });
  });
});

describe('scene-card-payloads / a stuck card settles as failed', () => {
  const spec: SceneCardSpec = {
    source: 'guolu',
    server: 'compass',
    resourceUri: 'ui://widget/scene-card.html',
    args: { scene: 'guolu' },
    argsKey: '{"scene":"guolu"}',
  };

  /** A capability server that accepts the request and never answers — the
   * exact failure the page-level Promise.all cannot survive without a
   * deadline. It honors abort the way a real fetch does. */
  const hangingFetch = (() =>
    (_input: unknown, init?: { signal?: AbortSignal | null }) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return;
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
          once: true,
        });
      }))() as unknown as typeof globalThis.fetch;

  const jsonFetch = (status: number, body: unknown) =>
    (() => () =>
      Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
      }))() as unknown as typeof globalThis.fetch;

  it('a hung request times out as a FAILED card, keeping its spec', async () => {
    const entry = await fetchSceneCard('/host', spec, { timeoutMs: 5, fetchImpl: hangingFetch });
    assert.deepEqual(entry.fetched, { status: 'error' });
    // Same shape as an HTTP error ⇒ the page proceeds and, being
    // display-less, degrades to side-by-side per canMergeCards.
    assert.equal(entry.source, 'guolu');
    assert.equal(entry.argsKey, '{"scene":"guolu"}');
    assert.equal(extractDisplayRows(undefined), null);
  });

  it('the caller aborting (unmount / project change) settles the same way', async () => {
    const cancel = new AbortController();
    const pending = fetchSceneCard('/host', spec, {
      timeoutMs: 60_000,
      fetchImpl: hangingFetch,
      signal: cancel.signal,
    });
    cancel.abort();
    assert.deepEqual((await pending).fetched, { status: 'error' });
  });

  it('an HTTP error is the same failed card; a good response is ready', async () => {
    const bad = await fetchSceneCard('/host', spec, { fetchImpl: jsonFetch(500, {}) });
    assert.deepEqual(bad.fetched, { status: 'error' });
    const ok = await fetchSceneCard('/host', spec, {
      fetchImpl: jsonFetch(200, { display: [row('k', 'S', 'L', 'v')] }),
    });
    assert.deepEqual(ok.fetched, { status: 'ready', result: { display: [row('k', 'S', 'L', 'v')] } });
  });
});
