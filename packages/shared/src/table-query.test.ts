import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyTextQuery,
  runTableQuery,
  sortRows,
  type TableQueryColumn,
  type TableQueryRow,
} from './table-query.js';

const columns: TableQueryColumn[] = [
  { key: 'name', name: 'Name', type: 'text' },
  { key: 'qty', name: 'Qty', type: 'number' },
  { key: 'status', name: 'Status', type: 'status' },
  { key: 'start', name: 'Start', type: 'text' },
];

const rows: TableQueryRow[] = [
  { row_id: 'r1', name: 'Alpha', qty: 10, status: 'open', start: '2026-06-10' },
  { row_id: 'r2', name: 'Beta', qty: 5, status: 'done', start: '2026-06-01' },
  { row_id: 'r3', name: 'Gamma', qty: 20, status: 'open', start: '2026-06-20' },
];

describe('applyTextQuery', () => {
  it('matches across columns case-insensitively', () => {
    const hit = applyTextQuery(rows, 'beta');
    assert.equal(hit.length, 1);
    assert.equal(hit[0]?.row_id, 'r2');
  });
});

describe('sortRows', () => {
  it('sorts by number column', () => {
    const sorted = sortRows(rows, columns, 'Qty', 'asc');
    assert.deepEqual(
      sorted.map((r) => r.row_id),
      ['r2', 'r1', 'r3'],
    );
  });
});

describe('runTableQuery', () => {
  it('filters with operators then paginates', () => {
    const result = runTableQuery(rows, columns, {
      filters: [{ column: 'status', op: 'eq', value: 'open' }],
      sortBy: 'qty',
      sortDir: 'desc',
      limit: 10,
    });
    assert.equal(result.mode, 'rows');
    if (result.mode !== 'rows') return;
    assert.equal(result.matchedRows, 2);
    assert.deepEqual(
      result.rows.map((r) => r.row_id),
      ['r3', 'r1'],
    );
  });

  it('supports row_keys then query', () => {
    const result = runTableQuery(rows, columns, {
      rowKeys: ['r1', 'r2'],
      query: 'alpha',
    });
    assert.equal(result.mode, 'rows');
    if (result.mode !== 'rows') return;
    assert.equal(result.matchedRows, 1);
    assert.equal(result.rows[0]?.row_id, 'r1');
  });

  it('aggregates with group_by and TOP-N sort/limit', () => {
    const result = runTableQuery(rows, columns, {
      aggregate: {
        metrics: [{ op: 'count' }, { op: 'sum', column: 'qty' }],
        groupBy: 'status',
      },
      sortBy: 'count',
      sortDir: 'desc',
      limit: 1,
    });
    assert.equal(result.mode, 'aggregate');
    if (result.mode !== 'aggregate') return;
    assert.equal(result.matchedRows, 3);
    assert.equal(result.matchedGroups, 2);
    assert.equal(result.groups.length, 1);
    assert.equal(result.hasMore, true);
    assert.equal(result.groups[0]?.status, 'open');
    assert.equal(result.groups[0]?.count, 2);
    assert.equal(result.groups[0]?.sum_qty, 30);
  });

  it('projects columns and keeps row_id', () => {
    const result = runTableQuery(rows, columns, {
      columns: ['name'],
      limit: 1,
    });
    assert.equal(result.mode, 'rows');
    if (result.mode !== 'rows') return;
    assert.equal(result.rows[0]?.row_id, 'r1');
    assert.equal(result.rows[0]?.name, 'Alpha');
    assert.equal(result.rows[0]?.qty, undefined);
  });

  it('supports empty / comparison ops', () => {
    const withEmpty: TableQueryRow[] = [
      ...rows,
      { row_id: 'r4', name: '', qty: 1, status: 'open', start: '' },
    ];
    const empty = runTableQuery(withEmpty, columns, {
      filters: [{ column: 'name', op: 'empty' }],
    });
    assert.equal(empty.mode, 'rows');
    if (empty.mode === 'rows') assert.equal(empty.matchedRows, 1);

    const gte = runTableQuery(rows, columns, {
      filters: [{ column: 'qty', op: 'gte', value: 10 }],
    });
    assert.equal(gte.mode, 'rows');
    if (gte.mode === 'rows') assert.equal(gte.matchedRows, 2);
  });

  it('skips empty strings for number min and uses text min/max for dates', () => {
    const mixed: TableQueryRow[] = [
      { row_id: 'a', name: 'A', qty: '', status: 'open', start: '2026-06-10' } as TableQueryRow,
      { row_id: 'b', name: 'B', qty: 5, status: 'open', start: '' },
      { row_id: 'c', name: 'C', qty: 2, status: 'open', start: '2026-06-01' },
    ];
    const numMin = runTableQuery(mixed, columns, {
      aggregate: { metrics: [{ op: 'min', column: 'qty' }, { op: 'max', column: 'qty' }] },
    });
    assert.equal(numMin.mode, 'aggregate');
    if (numMin.mode === 'aggregate') {
      assert.equal(numMin.groups[0]?.min_qty, 2);
      assert.equal(numMin.groups[0]?.max_qty, 5);
    }

    const dateRange = runTableQuery(mixed, columns, {
      aggregate: { metrics: [{ op: 'min', column: 'start' }, { op: 'max', column: 'start' }] },
    });
    assert.equal(dateRange.mode, 'aggregate');
    if (dateRange.mode === 'aggregate') {
      assert.equal(dateRange.groups[0]?.min_start, '2026-06-01');
      assert.equal(dateRange.groups[0]?.max_start, '2026-06-10');
    }
  });
});
