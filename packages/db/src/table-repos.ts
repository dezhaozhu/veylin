import { getDb } from './client';
import { normalizeId, queryRows, createRecord, upsertById, deleteById } from './query';
import type { TableColumnRow, TableRowRecord, TableSheetRow } from './types';

export async function listTableSheets(): Promise<TableSheetRow[]> {
  const rows = await queryRows<Record<string, unknown>>(getDb(), 'SELECT * FROM table_sheet');
  return rows.map((r) => ({
    id: normalizeId(r.id),
    name: String(r.name ?? ''),
    builtin: Boolean(r.builtin),
  }));
}

export async function upsertTableSheet(sheet: TableSheetRow): Promise<void> {
  await upsertById(getDb(), 'table_sheet', sheet.id, {
    name: sheet.name,
    builtin: sheet.builtin,
  });
}

export async function deleteTableSheet(sheetId: string): Promise<void> {
  await deleteById(getDb(), 'table_sheet', sheetId);
  await getDb().query('DELETE table_column WHERE sheet_id = $sheetId', { sheetId });
  await getDb().query('DELETE table_row WHERE sheet_id = $sheetId', { sheetId });
}

export async function listTableColumns(sheetId: string): Promise<TableColumnRow[]> {
  const rows = await queryRows<Record<string, unknown>>(
    getDb(),
    'SELECT * FROM table_column WHERE sheet_id = $sheetId ORDER BY position ASC',
    { sheetId },
  );
  return rows.map((r) => ({
    sheetId: String(r.sheet_id),
    key: String(r.key),
    name: String(r.name),
    width: Number(r.width ?? 100),
    type: String(r.type ?? 'text'),
    frozen: r.frozen != null ? Boolean(r.frozen) : undefined,
    deletable: Boolean(r.deletable ?? true),
    position: Number(r.position ?? 0),
    statusOptions: Array.isArray(r.status_options)
      ? (r.status_options as string[]).map(String)
      : undefined,
    semantics:
      r.semantics && typeof r.semantics === 'object'
        ? (r.semantics as Record<string, string>)
        : undefined,
  }));
}

export async function replaceTableColumns(
  sheetId: string,
  columns: TableColumnRow[],
): Promise<void> {
  await getDb().query('DELETE table_column WHERE sheet_id = $sheetId', { sheetId });
  for (const col of columns) {
    await createRecord(getDb(), 'table_column', {
      sheet_id: sheetId,
      key: col.key,
      name: col.name,
      width: col.width,
      type: col.type,
      ...(col.frozen !== undefined ? { frozen: col.frozen } : {}),
      deletable: col.deletable,
      position: col.position,
      ...(col.statusOptions?.length ? { status_options: col.statusOptions } : {}),
      ...(col.semantics && Object.keys(col.semantics).length ? { semantics: col.semantics } : {}),
    });
  }
}

export async function listTableRows(sheetId: string): Promise<TableRowRecord[]> {
  const rows = await queryRows<Record<string, unknown>>(
    getDb(),
    'SELECT * FROM table_row WHERE sheet_id = $sheetId ORDER BY position ASC',
    { sheetId },
  );
  return rows.map((r) => ({
    sheetId: String(r.sheet_id),
    rowKey: String(r.row_key),
    data: (r.data as Record<string, string | number>) ?? {},
    position: Number(r.position ?? 0),
  }));
}

export async function replaceTableRows(
  sheetId: string,
  rows: TableRowRecord[],
): Promise<void> {
  await getDb().query('DELETE table_row WHERE sheet_id = $sheetId', { sheetId });
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    await createRecord(getDb(), 'table_row', {
      sheet_id: sheetId,
      row_key: row.rowKey,
      data: row.data,
      position: row.position ?? i,
    });
  }
}

export async function upsertTableRow(row: TableRowRecord): Promise<void> {
  const existing = await queryRows<Record<string, unknown>>(
    getDb(),
    'SELECT * FROM table_row WHERE sheet_id = $sheetId AND row_key = $rowKey LIMIT 1',
    { sheetId: row.sheetId, rowKey: row.rowKey },
  );
  if (existing[0]) {
    await getDb().query(
      'UPDATE table_row SET data = $data WHERE sheet_id = $sheetId AND row_key = $rowKey',
      { sheetId: row.sheetId, rowKey: row.rowKey, data: row.data },
    );
    return;
  }
  await createRecord(getDb(), 'table_row', {
    sheet_id: row.sheetId,
    row_key: row.rowKey,
    data: row.data,
    position: row.position ?? 0,
  });
}

export async function deleteTableRows(sheetId: string, rowKeys: string[]): Promise<void> {
  for (const rowKey of rowKeys) {
    await getDb().query('DELETE table_row WHERE sheet_id = $sheetId AND row_key = $rowKey', {
      sheetId,
      rowKey,
    });
  }
}

export async function countTableSheets(): Promise<number> {
  const rows = await queryRows<Record<string, unknown>>(getDb(), 'SELECT * FROM table_sheet');
  return rows.length;
}
