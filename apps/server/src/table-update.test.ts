/**
 * Regression: table_update_cells / updateTableRow must not report success when
 * sanitize silently drops the patch (invalid status, unknown column, etc.).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_TABLE_STATUS_OPTIONS } from '@veylin/shared';
import {
  addTableColumn,
  addTableRow,
  createTableSheet,
  getTableRow,
  tryResolveTableSheetId,
  updateTableRow,
  updateTableRows,
} from './table-store.js';
import { buildTableTools, MAX_TABLE_CELL_UPDATES } from './table-tools.js';

function freshSheet(label: string): string {
  const meta = createTableSheet(`t-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  assert.ok(meta);
  return meta!.id;
}

describe('updateTableRow / table_update_cells false-success', () => {
  it('rejects invalid status values instead of ok:true with unchanged row', async () => {
    const sheet = freshSheet('bad-status');
    const col = addTableColumn(sheet, '状态');
    assert.ok(col);
    assert.equal(col!.type, 'status');
    assert.deepEqual(col!.statusOptions, [...DEFAULT_TABLE_STATUS_OPTIONS]);

    const row = addTableRow(sheet)!;
    const before = getTableRow(row.row_id, sheet);

    const result = await updateTableRow(row.row_id, { 状态: '123' }, sheet);
    assert.equal(result.ok, false);
    assert.match(result.message, /Invalid status value "123"/);
    assert.match(result.message, /open/);
    assert.equal(getTableRow(row.row_id, sheet)?.[col!.key], before?.[col!.key]);
  });

  it('accepts column display name for a valid status write', async () => {
    const sheet = freshSheet('name-map');
    const col = addTableColumn(sheet, '状态');
    assert.ok(col);
    const row = addTableRow(sheet)!;

    const result = await updateTableRow(row.row_id, { 状态: 'done' }, sheet);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.row[col!.key], 'done');
    assert.equal(Object.keys(result.applied).length, 1);
    assert.equal(result.rejected.length, 0);
  });

  it('rejects unknown column keys', async () => {
    const sheet = freshSheet('unknown-col');
    const row = addTableRow(sheet)!;
    const result = await updateTableRow(row.row_id, { no_such_col: 'x' }, sheet);
    assert.equal(result.ok, false);
    assert.match(result.message, /Unknown column/);
  });

  it('tryResolveTableSheetId does not fall back for unknown ids', () => {
    assert.equal(tryResolveTableSheetId('does_not_exist_sheet'), null);
    assert.equal(tryResolveTableSheetId(undefined), 'main');
    assert.equal(tryResolveTableSheetId(''), 'main');
  });

  it('updateTableRow rejects unknown sheet without writing main', async () => {
    const result = await updateTableRow('row_x', { a: '1' }, 'nope_sheet_xyz');
    assert.equal(result.ok, false);
    assert.match(result.message, /Sheet "nope_sheet_xyz" not found/);
  });

  it('table_update_cells tool returns ok:false for invalid status', async () => {
    const tools = buildTableTools();
    const sheet = freshSheet('tool-bad');
    addTableColumn(sheet, '状态');
    const row = addTableRow(sheet)!;

    const out = (await tools.table_update_cells.execute!(
      {
        sheet,
        updates: [{ row_key: row.row_id, column: '状态', value: '123' }],
      },
      {} as never,
    )) as { ok: boolean; message: string };

    assert.equal(out.ok, false);
    assert.match(out.message, /Invalid status value "123"/);
  });

  it('table_update_cells tool returns ok:false for unknown sheet', async () => {
    const tools = buildTableTools();
    const out = (await tools.table_update_cells.execute!(
      {
        sheet: 'nope_sheet_xyz',
        updates: [{ row_key: 'row_x', column: 'a', value: '1' }],
      },
      {} as never,
    )) as { ok: boolean; message: string };

    assert.equal(out.ok, false);
    assert.match(out.message, /Sheet "nope_sheet_xyz" not found/);
  });

  it('table_update_cells succeeds with column name and allowed status', async () => {
    const tools = buildTableTools();
    const sheet = freshSheet('tool-ok');
    const col = addTableColumn(sheet, '状态');
    assert.ok(col);
    const row = addTableRow(sheet)!;

    const out = (await tools.table_update_cells.execute!(
      {
        sheet,
        updates: [{ row_key: row.row_id, column: '状态', value: 'in_progress' }],
      },
      {} as never,
    )) as {
      ok: boolean;
      cells: Array<{ column: string; value: string | number; previous: string | number }>;
    };

    assert.equal(out.ok, true);
    assert.equal(out.cells.length, 1);
    assert.equal(out.cells[0]?.column, col!.key);
    assert.equal(out.cells[0]?.value, 'in_progress');
    assert.equal(out.cells[0]?.previous, '');
  });

  it('table_update_cells previous reflects a non-empty prior value', async () => {
    const tools = buildTableTools();
    const sheet = freshSheet('tool-prev');
    const col = addTableColumn(sheet, '备注');
    assert.ok(col);
    const row = addTableRow(sheet)!;
    await updateTableRow(row.row_id, { [col!.key]: 'old' }, sheet);

    const out = (await tools.table_update_cells.execute!(
      {
        sheet,
        updates: [{ row_key: row.row_id, column: '备注', value: 'new' }],
      },
      {} as never,
    )) as {
      ok: boolean;
      cells: Array<{ column: string; value: string | number; previous: string | number }>;
    };

    assert.equal(out.ok, true);
    assert.equal(out.cells[0]?.value, 'new');
    assert.equal(out.cells[0]?.previous, 'old');
  });

  it('table_update_cells rejects more than MAX_TABLE_CELL_UPDATES', async () => {
    const { applyTableCellUpdates } = await import('./table-tools.js');
    const sheet = freshSheet('tool-cap');
    const col = addTableColumn(sheet, '备注');
    assert.ok(col);
    const row = addTableRow(sheet)!;
    const updates = Array.from({ length: MAX_TABLE_CELL_UPDATES + 1 }, (_, i) => ({
      row_key: row.row_id,
      column: '备注',
      value: String(i),
    }));

    const out = await applyTableCellUpdates(sheet, updates);
    assert.equal(out.ok, false);
    assert.match(out.message, /Too many cell updates/);
  });

  it('table_update_cells updates multiple cells across rows in one call', async () => {
    const tools = buildTableTools();
    const sheet = freshSheet('tool-batch');
    const col = addTableColumn(sheet, '备注');
    assert.ok(col);
    const r1 = addTableRow(sheet)!;
    const r2 = addTableRow(sheet)!;

    const out = (await tools.table_update_cells.execute!(
      {
        sheet,
        updates: [
          { row_key: r1.row_id, column: '备注', value: 'a' },
          { row_key: r2.row_id, column: '备注', value: 'b' },
        ],
      },
      {} as never,
    )) as { ok: boolean; updated: number };

    assert.equal(out.ok, true);
    assert.equal(out.updated, 2);
    assert.equal(getTableRow(r1.row_id, sheet)?.[col!.key], 'a');
    assert.equal(getTableRow(r2.row_id, sheet)?.[col!.key], 'b');
  });
});

describe('updateTableRows batch', () => {
  it('applies multiple row patches atomically', async () => {
    const sheet = freshSheet('batch-ok');
    const col = addTableColumn(sheet, '备注');
    assert.ok(col);
    const r1 = addTableRow(sheet)!;
    const r2 = addTableRow(sheet)!;

    const result = await updateTableRows(
      [
        { rowKey: r1.row_id, patch: { [col!.key]: 'a' } },
        { rowKey: r2.row_id, patch: { [col!.key]: 'b' } },
      ],
      sheet,
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.rows.length, 2);
    assert.equal(getTableRow(r1.row_id, sheet)?.[col!.key], 'a');
    assert.equal(getTableRow(r2.row_id, sheet)?.[col!.key], 'b');
  });

  it('single-row batch works like one update', async () => {
    const sheet = freshSheet('batch-one');
    const col = addTableColumn(sheet, '备注');
    assert.ok(col);
    const row = addTableRow(sheet)!;
    const result = await updateTableRows(
      [{ rowKey: row.row_id, patch: { [col!.key]: 'solo' } }],
      sheet,
    );
    assert.equal(result.ok, true);
    assert.equal(getTableRow(row.row_id, sheet)?.[col!.key], 'solo');
  });

  it('rolls back entirely when one row is missing', async () => {
    const sheet = freshSheet('batch-atom');
    const col = addTableColumn(sheet, '备注');
    assert.ok(col);
    const row = addTableRow(sheet)!;

    const result = await updateTableRows(
      [
        { rowKey: row.row_id, patch: { [col!.key]: 'should-not-stick' } },
        { rowKey: 'missing_row_xyz', patch: { [col!.key]: 'x' } },
      ],
      sheet,
    );
    assert.equal(result.ok, false);
    assert.equal(getTableRow(row.row_id, sheet)?.[col!.key], undefined);
  });

  it('rejects empty updates', async () => {
    const sheet = freshSheet('batch-empty');
    const result = await updateTableRows([], sheet);
    assert.equal(result.ok, false);
    assert.match(result.message, /at least one/);
  });
});

describe('table_edit_structure / table_sheets', () => {
  it('adds rows and columns then deletes them', async () => {
    const tools = buildTableTools();
    const sheet = freshSheet('struct');

    const added = (await tools.table_edit_structure.execute!(
      {
        sheet,
        ops: [
          { op: 'add_columns', names: ['A', 'B'] },
          { op: 'add_rows', count: 2 },
        ],
      },
      {} as never,
    )) as {
      ok: boolean;
      results: Array<{
        op: string;
        ok: boolean;
        row_keys?: string[];
        columns?: Array<{ key: string }>;
      }>;
    };

    assert.equal(added.ok, true);
    const colResult = added.results.find((r) => r.op === 'add_columns');
    const rowResult = added.results.find((r) => r.op === 'add_rows');
    assert.equal(colResult?.columns?.length, 2);
    assert.equal(rowResult?.row_keys?.length, 2);

    const deleted = (await tools.table_edit_structure.execute!(
      {
        sheet,
        ops: [
          { op: 'delete_rows', row_keys: rowResult!.row_keys! },
          { op: 'delete_columns', columns: colResult!.columns!.map((c) => c.key) },
        ],
      },
      {} as never,
    )) as { ok: boolean };

    assert.equal(deleted.ok, true);
  });

  it('table_sheets lists, creates, and renames', async () => {
    const tools = buildTableTools();
    const threadId = `test-thread-${Date.now()}`;
    const ctx = {
      requestContext: {
        get(key: string) {
          return key === 'threadId' ? threadId : undefined;
        },
      },
    };

    const listed = (await tools.table_sheets.execute!(
      { action: 'list' },
      ctx as never,
    )) as { ok: boolean; sheets: Array<{ id: string }> };
    assert.equal(listed.ok, true);
    assert.ok(Array.isArray(listed.sheets));

    const created = (await tools.table_sheets.execute!(
      { action: 'create', name: `sheet-${Date.now()}` },
      ctx as never,
    )) as { ok: boolean; sheet: { id: string; name: string } | null };
    assert.equal(created.ok, true);
    assert.ok(created.sheet?.id);

    const renamed = (await tools.table_sheets.execute!(
      {
        action: 'rename',
        sheet: created.sheet!.id,
        name: `renamed-${Date.now()}`,
      },
      ctx as never,
    )) as { ok: boolean; sheet: { id: string; name: string } | null };
    assert.equal(renamed.ok, true);
    assert.equal(renamed.sheet?.id, created.sheet!.id);
    assert.ok(renamed.sheet?.name.startsWith('renamed-'));
  });
});
