/**
 * Regression: table_set_cell / updateTableRow must not report success when
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
} from './table-store.js';
import { buildTableTools } from './table-tools.js';

function freshSheet(label: string): string {
  const meta = createTableSheet(`t-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  assert.ok(meta);
  return meta!.id;
}

describe('updateTableRow / table_set_cell false-success', () => {
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

  it('table_set_cell tool returns ok:false for invalid status', async () => {
    const tools = buildTableTools();
    const sheet = freshSheet('tool-bad');
    addTableColumn(sheet, '状态');
    const row = addTableRow(sheet)!;

    const out = (await tools.table_set_cell.execute!(
      { sheet, row_key: row.row_id, column: '状态', value: '123' },
      {} as never,
    )) as { ok: boolean; message: string };

    assert.equal(out.ok, false);
    assert.match(out.message, /Invalid status value "123"/);
  });

  it('table_set_cell tool returns ok:false for unknown sheet', async () => {
    const tools = buildTableTools();
    const out = (await tools.table_set_cell.execute!(
      {
        sheet: 'nope_sheet_xyz',
        row_key: 'row_x',
        column: 'a',
        value: '1',
      },
      {} as never,
    )) as { ok: boolean; message: string };

    assert.equal(out.ok, false);
    assert.match(out.message, /Sheet "nope_sheet_xyz" not found/);
  });

  it('table_set_cell succeeds with column name and allowed status', async () => {
    const tools = buildTableTools();
    const sheet = freshSheet('tool-ok');
    const col = addTableColumn(sheet, '状态');
    assert.ok(col);
    const row = addTableRow(sheet)!;

    const out = (await tools.table_set_cell.execute!(
      {
        sheet,
        row_key: row.row_id,
        column: '状态',
        value: 'in_progress',
      },
      {} as never,
    )) as {
      ok: boolean;
      row: Record<string, string | number> | null;
      applied?: Record<string, string | number>;
      previous?: Record<string, string | number>;
    };

    assert.equal(out.ok, true);
    assert.equal(out.row?.[col!.key], 'in_progress');
    assert.equal(out.applied?.[col!.key], 'in_progress');
    assert.equal(out.previous?.[col!.key], '');
  });

  it('table_set_cell previous reflects a non-empty prior value', async () => {
    const tools = buildTableTools();
    const sheet = freshSheet('tool-prev');
    const col = addTableColumn(sheet, '备注');
    assert.ok(col);
    const row = addTableRow(sheet)!;
    await updateTableRow(row.row_id, { [col!.key]: 'old' }, sheet);

    const out = (await tools.table_set_cell.execute!(
      {
        sheet,
        row_key: row.row_id,
        column: '备注',
        value: 'new',
      },
      {} as never,
    )) as {
      ok: boolean;
      applied?: Record<string, string | number>;
      previous?: Record<string, string | number>;
    };

    assert.equal(out.ok, true);
    assert.equal(out.applied?.[col!.key], 'new');
    assert.equal(out.previous?.[col!.key], 'old');
  });
});
