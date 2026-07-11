import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { importTableSheet, queryTableRows } from './table-store.js';
import { buildTableTools } from './table-tools.js';

type TableGetResult = {
  sheet: string;
  totalRows: number;
  matchedRows: number;
  matchedGroups?: number;
  mode: 'rows' | 'aggregate';
  columns: Array<{ key: string; name: string; type: string }>;
  offset?: number;
  limit?: number;
  hasMore?: boolean;
  rows?: Array<Record<string, string | number>>;
  group_by?: string;
  groups?: Array<Record<string, string | number | null>>;
  notice?: string;
};

function asTableGet(result: unknown): TableGetResult {
  assert.ok(result && typeof result === 'object' && 'mode' in result);
  return result as TableGetResult;
}

describe('table_get query', () => {
  it('paginates with matchedRows and hasMore', async () => {
    importTableSheet('main', ['name', 'qty'], [
      { name: 'A', qty: 1 },
      { name: 'B', qty: 2 },
      { name: 'C', qty: 3 },
    ]);

    const { table_get } = buildTableTools();
    const page1 = asTableGet(await table_get.execute!({ offset: 0, limit: 2 }, {} as never));
    assert.equal(page1.mode, 'rows');
    assert.equal(page1.totalRows, 3);
    assert.equal(page1.matchedRows, 3);
    assert.equal(page1.rows?.length, 2);
    assert.equal(page1.hasMore, true);
    assert.match(page1.notice ?? '', /offset=2/);

    const page2 = asTableGet(await table_get.execute!({ offset: 2, limit: 2 }, {} as never));
    assert.equal(page2.rows?.length, 1);
    assert.equal(page2.hasMore, false);
  });

  it('supports query + sort + filters', async () => {
    importTableSheet('main', ['name', 'qty', 'status'], [
      { name: 'Alpha', qty: 10, status: 'open' },
      { name: 'Beta', qty: 5, status: 'done' },
      { name: 'Gamma', qty: 20, status: 'open' },
    ]);

    const { table_get } = buildTableTools();
    const result = asTableGet(
      await table_get.execute!(
        {
          filters: [{ column: 'status', op: 'eq', value: 'open' }],
          sort_by: 'qty',
          sort_dir: 'desc',
        },
        {} as never,
      ),
    );
    assert.equal(result.mode, 'rows');
    assert.equal(result.matchedRows, 2);
    assert.deepEqual(
      result.rows?.map((r) => r.name),
      ['Gamma', 'Alpha'],
    );
  });

  it('returns TOP-N aggregates without column schema bloat', async () => {
    importTableSheet('main', ['name', 'qty', 'status'], [
      { name: 'A', qty: 10, status: 'open' },
      { name: 'B', qty: 5, status: 'done' },
      { name: 'C', qty: 20, status: 'open' },
      { name: 'D', qty: 1, status: 'blocked' },
    ]);

    const { table_get } = buildTableTools();
    const result = asTableGet(
      await table_get.execute!(
        {
          aggregate: {
            metrics: [{ op: 'count' }, { op: 'sum', column: 'qty' }],
            group_by: 'status',
          },
          sort_by: 'count',
          sort_dir: 'desc',
          limit: 1,
        },
        {} as never,
      ),
    );
    assert.equal(result.mode, 'aggregate');
    assert.equal(result.matchedRows, 4);
    assert.equal(result.matchedGroups, 3);
    assert.equal(result.groups?.length, 1);
    assert.equal(result.hasMore, true);
    assert.equal(result.columns.length, 0);
    assert.equal(result.groups?.[0]?.status, 'open');
    assert.equal(result.groups?.[0]?.count, 2);
    assert.match(result.notice ?? '', /offset=1/);
  });

  it('honors sort_by nested inside aggregate as a compatibility alias', async () => {
    importTableSheet('main', ['name', 'qty', 'status'], [
      { name: 'A', qty: 10, status: 'open' },
      { name: 'B', qty: 5, status: 'done' },
      { name: 'C', qty: 20, status: 'open' },
      { name: 'D', qty: 1, status: 'blocked' },
    ]);

    const { table_get } = buildTableTools();
    const result = asTableGet(
      await table_get.execute!(
        {
          aggregate: {
            metrics: [{ op: 'count' }],
            group_by: 'status',
            sort_by: 'count',
            sort_dir: 'desc',
          },
          limit: 3,
        },
        {} as never,
      ),
    );
    assert.equal(result.mode, 'aggregate');
    assert.equal(result.groups?.length, 3);
    assert.equal(result.groups?.[0]?.status, 'open');
    assert.equal(result.groups?.[0]?.count, 2);
    assert.deepEqual(
      result.groups?.slice(1).map((g) => g.count).sort(),
      [1, 1],
    );
    assert.match(result.notice ?? '', /read from aggregate/);
  });

  it('queryTableRows caps limit at MAX', () => {
    importTableSheet('main', ['name'], Array.from({ length: 5 }, (_, i) => ({ name: `r${i}` })));
    const result = queryTableRows('main', { limit: 9999 });
    assert.equal(result.mode, 'rows');
    if (result.mode === 'rows') {
      assert.equal(result.limit, 200);
      assert.equal(result.rows.length, 5);
    }
  });
});
