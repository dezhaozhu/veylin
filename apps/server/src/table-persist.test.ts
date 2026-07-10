/**
 * Persist queue + row-order. Uses the process SurrealDB (same pattern as table-store.delete.test).
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { closeDb, connectDb, listTableRows as listTableRowsDb } from '@veylin/db';
import {
  addTableColumn,
  addTableRow,
  createTableSheet,
  flushTablePersists,
  importTableSheet,
  initTableStore,
  listTableRows,
  updateTableRow,
} from './table-store.js';

describe('table persist queue', () => {
  before(async () => {
    await connectDb();
    await initTableStore();
  });

  after(async () => {
    await flushTablePersists();
    await closeDb();
  });

  it('flushes concurrent edits so the latest snapshot is on disk', async () => {
    const meta = createTableSheet(`persist-${Date.now()}`)!;
    const sheet = meta.id;
    addTableColumn(sheet, 'name');
    const r1 = addTableRow(sheet)!;
    const r2 = addTableRow(sheet)!;
    const r3 = addTableRow(sheet)!;

    await Promise.all([
      updateTableRow(r1.row_id, { name: 'a' }, sheet),
      updateTableRow(r2.row_id, { name: 'b' }, sheet),
      updateTableRow(r3.row_id, { name: 'c' }, sheet),
    ]);
    await flushTablePersists();

    const dbRows = await listTableRowsDb(sheet);
    assert.equal(dbRows.length, 3);
    const byKey = new Map(dbRows.map((r) => [r.rowKey, r]));
    assert.equal(byKey.get(r1.row_id)?.data.name, 'a');
    assert.equal(byKey.get(r2.row_id)?.data.name, 'b');
    assert.equal(byKey.get(r3.row_id)?.data.name, 'c');
  });

  it('persists row order via position', async () => {
    const meta = createTableSheet(`order-${Date.now()}`)!;
    const sheet = meta.id;
    importTableSheet(sheet, ['label'], [
      { label: 'first' },
      { label: 'second' },
      { label: 'third' },
    ]);
    await flushTablePersists();

    assert.deepEqual(
      listTableRows(sheet).map((r) => String(r.label)),
      ['first', 'second', 'third'],
    );

    const dbRows = await listTableRowsDb(sheet);
    assert.deepEqual(
      dbRows.map((r) => String(r.data.label)),
      ['first', 'second', 'third'],
    );
    assert.deepEqual(
      dbRows.map((r) => r.position),
      [0, 1, 2],
    );
  });
});
