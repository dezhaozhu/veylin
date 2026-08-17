/**
 * Unit tests for the table-store change-event bus (backs the SSE live-sync endpoint).
 *
 * The store is an in-memory singleton; DB persistence (tablePersist) is fire-and-forget
 * and fails silently without SurrealDB, so these run with no DB setup. We exercise the
 * synchronous mutators (each event type is covered; updateTableRow's rowUpsert is the
 * same shape as addTableRow's).
 */
import { describe, it } from 'node:test';
import { PERSONAL_SCOPE, sheetIdFor } from './table-scope.js';
import assert from 'node:assert/strict';
import {
  onTableEvent,
  addTableRow,
  deleteTableRows,
  addTableColumn,
  importTableSheet,
  createTableSheet,
  listTableSheets,
  resetTableStoreMemory,
  type TableEvent,
} from './table-store.js';

// 表有归属:mutator 拿的是**内部 id**(个人区的 main = `me~main`)。
const MAIN = sheetIdFor(PERSONAL_SCOPE, 'main');

// No resetTableStore(): it awaits a real DB (persistAll), unlike the fire-and-forget
// mutators. Each test observes only its own mutation's event, so shared store state is fine.
describe('table-store change events', () => {
  it('addTableRow emits rowUpsert with the new row', () => {
    const events: TableEvent[] = [];
    const off = onTableEvent((e) => events.push(e));
    const row = addTableRow(MAIN);
    off();
    assert.ok(row);
    const upsert = events.find((e) => e.type === 'rowUpsert');
    assert.ok(upsert && upsert.type === 'rowUpsert');
    assert.equal(upsert.row.row_id, row!.row_id);
  });

  it('deleteTableRows emits rowsDelete carrying the keys', () => {
    const row = addTableRow(MAIN)!;
    const events: TableEvent[] = [];
    const off = onTableEvent((e) => events.push(e));
    deleteTableRows(MAIN, [row.row_id]);
    off();
    const del = events.find((e) => e.type === 'rowsDelete');
    assert.ok(del && del.type === 'rowsDelete');
    assert.deepEqual(del.keys, [row.row_id]);
  });

  it('addTableColumn emits schemaChange', () => {
    const events: TableEvent[] = [];
    const off = onTableEvent((e) => events.push(e));
    addTableColumn(MAIN, 'newcol');
    off();
    assert.ok(events.some((e) => e.type === 'schemaChange'));
  });

  it('importTableSheet emits sheetReplace', () => {
    const events: TableEvent[] = [];
    const off = onTableEvent((e) => events.push(e));
    importTableSheet(MAIN, ['a', 'b'], [{ a: '1', b: '2' }]);
    off();
    assert.ok(events.some((e) => e.type === 'sheetReplace'));
  });

  it('createTableSheet emits sheetsChange', () => {
    const events: TableEvent[] = [];
    const off = onTableEvent((e) => events.push(e));
    createTableSheet('Sheet X', PERSONAL_SCOPE);
    off();
    assert.ok(events.some((e) => e.type === 'sheetsChange'));
  });

  it('unsubscribe stops delivery', () => {
    const events: TableEvent[] = [];
    const off = onTableEvent((e) => events.push(e));
    off();
    addTableRow(MAIN);
    assert.equal(events.length, 0);
  });

  it('importing content into a non-main sheet prunes empty default Sheet 1', () => {
    resetTableStoreMemory();
    assert.ok(listTableSheets().some((s) => s.id === MAIN));

    const created = createTableSheet(`orders-prune-${Date.now()}`, PERSONAL_SCOPE);
    assert.ok(created);
    // Blank sibling should NOT prune Sheet 1 yet.
    assert.ok(listTableSheets().some((s) => s.id === MAIN));

    importTableSheet(created!.id, ['订单号'], [{ 订单号: 'T-1' }]);
    assert.equal(
      listTableSheets().some((s) => s.id === MAIN),
      false,
      'empty Sheet 1 should be removed once another sheet has content',
    );
    assert.ok(listTableSheets().some((s) => s.id === created!.id));
  });

  it('keeps empty Sheet 1 when the user only adds another blank sheet', () => {
    resetTableStoreMemory();
    createTableSheet(`blank-${Date.now()}`, PERSONAL_SCOPE);
    assert.ok(listTableSheets().some((s) => s.id === MAIN));
  });
});
