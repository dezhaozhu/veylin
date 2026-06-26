/**
 * Multi-sheet schedule store with SurrealDB persistence.
 */

import {
  countScheduleSheets,
  deleteScheduleSheet as deleteScheduleSheetDb,
  listScheduleColumns as listScheduleColumnsDb,
  listScheduleRows as listScheduleRowsDb,
  listScheduleSheets as listScheduleSheetsDb,
  replaceScheduleColumns,
  replaceScheduleRows,
  upsertScheduleSheet,
} from '@veylin/db';

export type ScheduleStatus = 'normal' | 'tight' | 'overdue';
export type ScheduleColumnType = 'text' | 'number' | 'status';

export interface ScheduleColumnDef {
  key: string;
  name: string;
  width: number;
  type: ScheduleColumnType;
  frozen?: boolean;
  deletable: boolean;
}

export interface ScheduleSheetMeta {
  id: string;
  name: string;
  builtin: boolean;
}

export type ScheduleRowData = Record<string, string | number> & { order_no: string };

export type ScheduleRowPatch = Record<string, string | number>;

export const DEFAULT_SCHEDULE_SHEET = 'main';

const VALID_STATUS: ReadonlySet<string> = new Set<ScheduleStatus>(['normal', 'tight', 'overdue']);

const DEFAULT_COLUMNS: ScheduleColumnDef[] = [
  { key: 'order_no', name: 'Order No.', width: 100, type: 'text', frozen: true, deletable: false },
  { key: 'product', name: 'Product', width: 130, type: 'text', deletable: true },
  { key: 'qty', name: 'Qty', width: 72, type: 'number', deletable: true },
  { key: 'planned_start', name: 'Planned Start', width: 140, type: 'text', deletable: true },
  { key: 'planned_end', name: 'Planned End', width: 140, type: 'text', deletable: true },
  { key: 'resource', name: 'Resource', width: 140, type: 'text', deletable: true },
  { key: 'status', name: 'Status', width: 80, type: 'status', deletable: true },
];

const BUILTIN_SHEETS: ScheduleSheetMeta[] = [
  { id: 'main', name: 'Main Plan', builtin: true },
];

interface SheetState {
  meta: ScheduleSheetMeta;
  columns: ScheduleColumnDef[];
  rows: ScheduleRowData[];
}

function cloneColumns(): ScheduleColumnDef[] {
  return DEFAULT_COLUMNS.map((c) => ({ ...c }));
}

function scheduleRowKey(row: ScheduleRowData): string {
  return String(row.row_id ?? row.order_no);
}

function emptyRow(): ScheduleRowData {
  return {
    row_id: `row_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    order_no: '',
  };
}

function buildInitialStore(): Map<string, SheetState> {
  const store = new Map<string, SheetState>();
  for (const meta of BUILTIN_SHEETS) {
    store.set(meta.id, {
      meta: { ...meta },
      columns: cloneColumns(),
      rows: [],
    });
  }
  return store;
}

let sheetStore = buildInitialStore();
let scheduleHydrated = false;

async function persistSheet(sheetId: string): Promise<void> {
  const sheet = sheetStore.get(sheetId);
  if (!sheet) return;
  await upsertScheduleSheet({ ...sheet.meta });
  await replaceScheduleColumns(
    sheetId,
    sheet.columns.map((c, i) => ({
      sheetId,
      key: c.key,
      name: c.name,
      width: c.width,
      type: c.type,
      frozen: c.frozen,
      deletable: c.deletable,
      position: i,
    })),
  );
  await replaceScheduleRows(
    sheetId,
    sheet.rows.map((r) => ({
      sheetId,
      rowKey: scheduleRowKey(r),
      data: { ...r },
    })),
  );
}

async function persistAll(): Promise<void> {
  for (const id of sheetStore.keys()) {
    await persistSheet(id);
  }
}

/** Fire-and-forget persist that never lets a rejection crash the process. */
function schedulePersist(sheetId: string): void {
  void persistSheet(sheetId).catch((e) => {
    console.error('[schedule] persist failed:', e);
  });
}

/** Load schedule from SurrealDB or seed builtin sheets on first run. */
export async function initScheduleStore(): Promise<void> {
  if (scheduleHydrated) return;
  const count = await countScheduleSheets();
  if (count === 0) {
    sheetStore = buildInitialStore();
    await persistAll();
  } else {
    const sheets = await listScheduleSheetsDb();
    const next = new Map<string, SheetState>();
    for (const meta of sheets) {
      const columns = await listScheduleColumnsDb(meta.id);
      const rows = await listScheduleRowsDb(meta.id);
      next.set(meta.id, {
        meta,
        columns: columns.map((c) => ({
          key: c.key,
          name: c.name,
          width: c.width,
          type: c.type as ScheduleColumnType,
          frozen: c.frozen,
          deletable: c.deletable,
        })),
        rows: rows.map((r) => ({ ...r.data } as ScheduleRowData)),
      });
    }
    sheetStore = next;
    if (!sheetStore.has(DEFAULT_SCHEDULE_SHEET)) {
      const initial = buildInitialStore();
      const main = initial.get(DEFAULT_SCHEDULE_SHEET)!;
      sheetStore.set(DEFAULT_SCHEDULE_SHEET, main);
      await persistSheet(DEFAULT_SCHEDULE_SHEET);
    }
  }
  scheduleHydrated = true;
}

function getSheet(sheetId: string): SheetState | undefined {
  return sheetStore.get(sheetId);
}

function slugifyColumnKey(name: string, columns: ScheduleColumnDef[]): string {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_\u4e00-\u9fff-]/g, '') || 'col';
  let key = base;
  let n = 1;
  while (columns.some((c) => c.key === key)) {
    key = `${base}_${n++}`;
  }
  return key;
}

function sanitizePatch(
  patch: ScheduleRowPatch,
  columns: ScheduleColumnDef[],
): ScheduleRowPatch {
  const out: ScheduleRowPatch = {};
  if (patch.order_no != null) out.order_no = String(patch.order_no);
  for (const col of columns) {
    if (col.key === 'order_no') continue;
    const raw = patch[col.key];
    if (raw === undefined) continue;
    if (col.type === 'number') {
      if (raw === '' || raw === undefined) {
        out[col.key] = '';
        continue;
      }
      const n = Number(raw);
      if (Number.isFinite(n)) out[col.key] = n;
    } else if (col.type === 'status') {
      if (raw === '' || raw === undefined) {
        out[col.key] = '';
        continue;
      }
      if (VALID_STATUS.has(String(raw))) out[col.key] = String(raw);
    } else {
      out[col.key] = String(raw);
    }
  }
  return out;
}

export function resolveScheduleSheetId(value: string | undefined): string {
  if (value && sheetStore.has(value)) return value;
  return DEFAULT_SCHEDULE_SHEET;
}

export function listScheduleSheets(): ScheduleSheetMeta[] {
  return [...sheetStore.values()].map((s) => ({ ...s.meta }));
}

export function listScheduleColumns(sheetId: string): ScheduleColumnDef[] {
  const sheet = getSheet(resolveScheduleSheetId(sheetId));
  return sheet ? sheet.columns.map((c) => ({ ...c })) : [];
}

export function listSchedule(sheetId: string = DEFAULT_SCHEDULE_SHEET): ScheduleRowData[] {
  const sheet = getSheet(resolveScheduleSheetId(sheetId));
  return sheet ? sheet.rows.map((r) => ({ ...r })) : [];
}

export function getScheduleRow(orderNo: string, sheetId: string = DEFAULT_SCHEDULE_SHEET) {
  const sheet = getSheet(resolveScheduleSheetId(sheetId));
  const found = sheet?.rows.find((r) => r.order_no === orderNo);
  return found ? { ...found } : undefined;
}

export async function updateScheduleRow(
  rowKey: string,
  patch: ScheduleRowPatch,
  sheetId: string = DEFAULT_SCHEDULE_SHEET,
): Promise<ScheduleRowData | null> {
  const sheet = getSheet(resolveScheduleSheetId(sheetId));
  if (!sheet) return null;
  const idx = sheet.rows.findIndex((r) => scheduleRowKey(r) === rowKey);
  if (idx === -1) return null;
  const clean = sanitizePatch(patch, sheet.columns);
  sheet.rows[idx] = { ...sheet.rows[idx]!, ...clean };
  await persistSheet(resolveScheduleSheetId(sheetId));
  return { ...sheet.rows[idx]! };
}

function slugifySheetId(name: string): string {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_\u4e00-\u9fff-]/g, '') || 'sheet';
  let id = base;
  let n = 1;
  while (sheetStore.has(id)) {
    id = `${base}_${n++}`;
  }
  return id;
}

export function createScheduleSheet(name: string): ScheduleSheetMeta | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const id = slugifySheetId(trimmed);
  const meta: ScheduleSheetMeta = { id, name: trimmed, builtin: false };
  sheetStore.set(id, {
    meta,
    columns: cloneColumns(),
    rows: [],
  });
  schedulePersist(id);
  return { ...meta };
}

export async function deleteScheduleSheet(sheetId: string): Promise<boolean> {
  const sheet = sheetStore.get(sheetId);
  if (!sheet || sheet.meta.builtin || sheetId === DEFAULT_SCHEDULE_SHEET) return false;
  sheetStore.delete(sheetId);
  try {
    await deleteScheduleSheetDb(sheetId);
    return true;
  } catch (e) {
    console.error('[schedule] delete sheet failed:', e);
    return false;
  }
}

export function addScheduleRow(sheetId: string): ScheduleRowData | null {
  const sheet = getSheet(resolveScheduleSheetId(sheetId));
  if (!sheet) return null;
  const row = emptyRow();
  sheet.rows.push(row);
  schedulePersist(resolveScheduleSheetId(sheetId));
  return { ...row };
}

export function deleteScheduleRows(sheetId: string, rowKeys: string[]): number {
  const sheet = getSheet(resolveScheduleSheetId(sheetId));
  if (!sheet || rowKeys.length === 0) return 0;
  const drop = new Set(rowKeys);
  const before = sheet.rows.length;
  sheet.rows = sheet.rows.filter((r) => !drop.has(scheduleRowKey(r)));
  schedulePersist(resolveScheduleSheetId(sheetId));
  return before - sheet.rows.length;
}

export function addScheduleColumn(sheetId: string, name: string): ScheduleColumnDef | null {
  const sheet = getSheet(resolveScheduleSheetId(sheetId));
  const trimmed = name.trim();
  if (!sheet || !trimmed) return null;
  const col: ScheduleColumnDef = {
    key: slugifyColumnKey(trimmed, sheet.columns),
    name: trimmed,
    width: 110,
    type: 'text',
    deletable: true,
  };
  sheet.columns.push(col);
  schedulePersist(resolveScheduleSheetId(sheetId));
  return { ...col };
}

export function deleteScheduleColumn(sheetId: string, columnKey: string): boolean {
  const sheet = getSheet(resolveScheduleSheetId(sheetId));
  if (!sheet) return false;
  const col = sheet.columns.find((c) => c.key === columnKey);
  if (!col || !col.deletable) return false;
  sheet.columns = sheet.columns.filter((c) => c.key !== columnKey);
  for (const row of sheet.rows) {
    delete row[columnKey];
  }
  schedulePersist(resolveScheduleSheetId(sheetId));
  return true;
}

/** Replace sheet rows from an Excel import; optionally add columns by display name. */
export function importScheduleSheet(
  sheetId: string,
  importedRows: ScheduleRowPatch[],
  newColumnNames: string[] = [],
): { columns: ScheduleColumnDef[]; rows: ScheduleRowData[] } | null {
  const resolved = resolveScheduleSheetId(sheetId);
  const sheet = getSheet(resolved);
  if (!sheet) return null;

  for (const name of newColumnNames) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const exists = sheet.columns.some(
      (c) => c.name === trimmed || c.key === trimmed,
    );
    if (!exists) addScheduleColumn(resolved, trimmed);
  }

  const fresh = getSheet(resolved);
  if (!fresh) return null;

  fresh.rows = importedRows.map((raw) => {
    const base = emptyRow();
    const clean = sanitizePatch(raw, fresh.columns);
    return { ...base, ...clean };
  });

  schedulePersist(resolved);

  return {
    columns: fresh.columns.map((c) => ({ ...c })),
    rows: fresh.rows.map((r) => ({ ...r })),
  };
}

export async function resetSchedule(): Promise<void> {
  sheetStore = buildInitialStore();
  await persistAll();
}
