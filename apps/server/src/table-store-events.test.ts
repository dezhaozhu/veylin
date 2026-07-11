/**
 * Unit tests for the table-store change-event bus (backs the SSE live-sync endpoint).
 *
 * The store is an in-memory singleton; DB persistence (tablePersist) is fire-and-forget
 * and fails silently without SurrealDB, so these run with no DB setup. We exercise the
 * synchronous mutators (each event type is covered; updateTableRow's rowUpsert is the
 * same shape as addTableRow's).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  onTableEvent,
  addTableRow,
  deleteTableRows,
  addTableColumn,
  importTableSheet,
  createTableSheet,
  renameTableSheet,
  allocateUniqueSheetName,
  repairDuplicateTableSheetNames,
  unsafeSetTableSheetNameForTests,
  listTableSheets,
  type TableEvent,
} from './table-store.js';

// No resetTableStore(): it awaits a real DB (persistAll), unlike the fire-and-forget
// mutators. Each test observes only its own mutation's event, so shared store state is fine.
describe('table-store change events', () => {
  it('addTableRow emits rowUpsert with the new row', () => {
    const events: TableEvent[] = [];
    const off = onTableEvent((e) => events.push(e));
    const row = addTableRow('main');
    off();
    assert.ok(row);
    const upsert = events.find((e) => e.type === 'rowUpsert');
    assert.ok(upsert && upsert.type === 'rowUpsert');
    assert.equal(upsert.row.row_id, row!.row_id);
  });

  it('deleteTableRows emits rowsDelete carrying the keys', () => {
    const row = addTableRow('main')!;
    const events: TableEvent[] = [];
    const off = onTableEvent((e) => events.push(e));
    deleteTableRows('main', [row.row_id]);
    off();
    const del = events.find((e) => e.type === 'rowsDelete');
    assert.ok(del && del.type === 'rowsDelete');
    assert.deepEqual(del.keys, [row.row_id]);
  });

  it('addTableColumn emits schemaChange', () => {
    const events: TableEvent[] = [];
    const off = onTableEvent((e) => events.push(e));
    addTableColumn('main', 'newcol');
    off();
    assert.ok(events.some((e) => e.type === 'schemaChange'));
  });

  it('importTableSheet emits sheetReplace', () => {
    const events: TableEvent[] = [];
    const off = onTableEvent((e) => events.push(e));
    importTableSheet('main', ['a', 'b'], [{ a: '1', b: '2' }]);
    off();
    assert.ok(events.some((e) => e.type === 'sheetReplace'));
  });

  it('createTableSheet emits sheetsChange', () => {
    const events: TableEvent[] = [];
    const off = onTableEvent((e) => events.push(e));
    createTableSheet(`Sheet X ${Date.now()}`);
    off();
    assert.ok(events.some((e) => e.type === 'sheetsChange'));
  });

  it('renameTableSheet updates display name and emits sheetsChange', () => {
    const created = createTableSheet(`Rename Me ${Date.now()}`)!;
    const events: TableEvent[] = [];
    const off = onTableEvent((e) => events.push(e));
    const renamed = renameTableSheet(created.id, `Renamed Sheet ${Date.now()}`);
    off();
    assert.ok(renamed);
    assert.equal(renamed!.id, created.id);
    assert.ok(events.some((e) => e.type === 'sheetsChange'));
  });

  it('rejects duplicate sheet display names (case-insensitive)', () => {
    const stamp = Date.now();
    const a = createTableSheet(`Unique ${stamp}`)!;
    assert.ok(a);
    assert.equal(createTableSheet(`unique ${stamp}`), null);
    const b = createTableSheet(`Other ${stamp}`)!;
    assert.equal(renameTableSheet(b.id, `UNIQUE ${stamp}`), null);
    const cased = renameTableSheet(a.id, `UNIQUE ${stamp}`);
    assert.ok(cased);
    assert.equal(cased!.name, `UNIQUE ${stamp}`);
  });

  it('allocateUniqueSheetName bumps Sheet N and repairs legacy duplicates', () => {
    const stamp = Date.now();
    const a = createTableSheet(`Dup Base ${stamp}`)!;
    assert.equal(allocateUniqueSheetName(`Dup Base ${stamp}`), `Dup Base ${stamp} (2)`);
    // Builtin main is "Sheet 1" in a fresh store — next free tab is Sheet 2+.
    assert.match(allocateUniqueSheetName('Sheet 1'), /^Sheet \d+$/);
    assert.notEqual(allocateUniqueSheetName('Sheet 1'), 'Sheet 1');

    const b = createTableSheet(`Dup Other ${stamp}`)!;
    unsafeSetTableSheetNameForTests(a.id, `Clash ${stamp}`);
    unsafeSetTableSheetNameForTests(b.id, `Clash ${stamp}`);
    assert.equal(repairDuplicateTableSheetNames(), true);
    const names = listTableSheets()
      .filter((s) => s.id === a.id || s.id === b.id)
      .map((s) => s.name)
      .sort();
    assert.deepEqual(names, [`Clash ${stamp}`, `Clash ${stamp} (2)`]);
  });

  it('unsubscribe stops delivery', () => {
    const events: TableEvent[] = [];
    const off = onTableEvent((e) => events.push(e));
    off();
    addTableRow('main');
    assert.equal(events.length, 0);
  });
});
