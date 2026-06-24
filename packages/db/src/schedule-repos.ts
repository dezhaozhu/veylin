import { getDb } from './client';
import { normalizeId, queryRows, createRecord, upsertById, deleteById } from './query';
import type { ScheduleColumnRow, ScheduleRowRecord, ScheduleSheetRow } from './types';

export async function listScheduleSheets(): Promise<ScheduleSheetRow[]> {
  const rows = await queryRows<Record<string, unknown>>(getDb(), 'SELECT * FROM schedule_sheet');
  return rows.map((r) => ({
    id: normalizeId(r.id),
    name: String(r.name ?? ''),
    builtin: Boolean(r.builtin),
  }));
}

export async function upsertScheduleSheet(sheet: ScheduleSheetRow): Promise<void> {
  await upsertById(getDb(), 'schedule_sheet', sheet.id, {
    name: sheet.name,
    builtin: sheet.builtin,
  });
}

export async function deleteScheduleSheet(sheetId: string): Promise<void> {
  await deleteById(getDb(), 'schedule_sheet', sheetId);
  await getDb().query('DELETE schedule_column WHERE sheet_id = $sheetId', { sheetId });
  await getDb().query('DELETE schedule_row WHERE sheet_id = $sheetId', { sheetId });
}

export async function listScheduleColumns(sheetId: string): Promise<ScheduleColumnRow[]> {
  const rows = await queryRows<Record<string, unknown>>(
    getDb(),
    'SELECT * FROM schedule_column WHERE sheet_id = $sheetId ORDER BY position ASC',
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
  }));
}

export async function replaceScheduleColumns(
  sheetId: string,
  columns: ScheduleColumnRow[],
): Promise<void> {
  await getDb().query('DELETE schedule_column WHERE sheet_id = $sheetId', { sheetId });
  for (const col of columns) {
    await createRecord(getDb(), 'schedule_column', {
      sheet_id: sheetId,
      key: col.key,
      name: col.name,
      width: col.width,
      type: col.type,
      ...(col.frozen !== undefined ? { frozen: col.frozen } : {}),
      deletable: col.deletable,
      position: col.position,
    });
  }
}

export async function listScheduleRows(sheetId: string): Promise<ScheduleRowRecord[]> {
  const rows = await queryRows<Record<string, unknown>>(
    getDb(),
    'SELECT * FROM schedule_row WHERE sheet_id = $sheetId',
    { sheetId },
  );
  return rows.map((r) => ({
    sheetId: String(r.sheet_id),
    rowKey: String(r.row_key),
    data: (r.data as Record<string, string | number>) ?? {},
  }));
}

export async function replaceScheduleRows(
  sheetId: string,
  rows: ScheduleRowRecord[],
): Promise<void> {
  await getDb().query('DELETE schedule_row WHERE sheet_id = $sheetId', { sheetId });
  for (const row of rows) {
    await createRecord(getDb(), 'schedule_row', {
      sheet_id: sheetId,
      row_key: row.rowKey,
      data: row.data,
    });
  }
}

export async function upsertScheduleRow(row: ScheduleRowRecord): Promise<void> {
  const existing = await queryRows<Record<string, unknown>>(
    getDb(),
    'SELECT * FROM schedule_row WHERE sheet_id = $sheetId AND row_key = $rowKey LIMIT 1',
    { sheetId: row.sheetId, rowKey: row.rowKey },
  );
  if (existing[0]) {
    await getDb().query(
      'UPDATE schedule_row SET data = $data WHERE sheet_id = $sheetId AND row_key = $rowKey',
      { sheetId: row.sheetId, rowKey: row.rowKey, data: row.data },
    );
    return;
  }
  await createRecord(getDb(), 'schedule_row', {
    sheet_id: row.sheetId,
    row_key: row.rowKey,
    data: row.data,
  });
}

export async function deleteScheduleRows(sheetId: string, rowKeys: string[]): Promise<void> {
  for (const rowKey of rowKeys) {
    await getDb().query('DELETE schedule_row WHERE sheet_id = $sheetId AND row_key = $rowKey', {
      sheetId,
      rowKey,
    });
  }
}

export async function countScheduleSheets(): Promise<number> {
  const rows = await queryRows<Record<string, unknown>>(getDb(), 'SELECT * FROM schedule_sheet');
  return rows.length;
}
