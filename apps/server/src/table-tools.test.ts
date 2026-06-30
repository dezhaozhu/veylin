import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { importTableSheet, listTableRowsPage } from './table-store.js';
import { buildTableTools } from './table-tools.js';

describe('table_get pagination', () => {
  it('returns a bounded page with totalRows and hasMore', async () => {
    importTableSheet('main', ['name', 'qty'], [
      { name: 'A', qty: 1 },
      { name: 'B', qty: 2 },
      { name: 'C', qty: 3 },
    ]);

    const { table_get } = buildTableTools();
    const page1 = await table_get.execute!(
      { offset: 0, limit: 2 },
      {} as never,
    );
    assert.ok(page1 && typeof page1 === 'object' && 'totalRows' in page1);
    assert.equal(page1.totalRows, 3);
    assert.equal(page1.rows.length, 2);
    assert.equal(page1.hasMore, true);
    assert.match(page1.notice ?? '', /offset=2/);

    const page2 = await table_get.execute!({ offset: 2, limit: 2 }, {} as never);
    assert.ok(page2 && typeof page2 === 'object' && 'rows' in page2);
    assert.equal(page2.rows.length, 1);
    assert.equal(page2.hasMore, false);
  });

  it('listTableRowsPage never returns more rows than exist', () => {
    const { totalRows, rows } = listTableRowsPage('main', 0, 9999);
    assert.equal(totalRows, 3);
    assert.equal(rows.length, 3);
  });
});
