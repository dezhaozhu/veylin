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

type SeedRow = ScheduleRowData;

const SEED_ROWS: Record<string, SeedRow[]> = {
  main: [
    { order_no: 'WO-1001', product: 'Gearbox A', qty: 120, planned_start: '2026-06-21 08:00', planned_end: '2026-06-22 16:00', resource: 'Line 1 - CNC', status: 'normal' },
    { order_no: 'WO-1002', product: 'Flange B', qty: 320, planned_start: '2026-06-21 09:30', planned_end: '2026-06-21 18:00', resource: 'Line 1 - Stamping', status: 'tight' },
    { order_no: 'WO-1003', product: 'Bearing Seat C', qty: 80, planned_start: '2026-06-20 14:00', planned_end: '2026-06-21 10:00', resource: 'Line 2 - Lathe', status: 'overdue' },
    { order_no: 'WO-1004', product: 'Motor Case D', qty: 200, planned_start: '2026-06-22 08:00', planned_end: '2026-06-23 12:00', resource: 'Line 2 - Injection', status: 'normal' },
    { order_no: 'WO-1005', product: 'Gearbox A', qty: 60, planned_start: '2026-06-22 13:00', planned_end: '2026-06-22 20:00', resource: 'Line 1 - CNC', status: 'tight' },
    { order_no: 'WO-1006', product: 'Bracket E', qty: 450, planned_start: '2026-06-19 08:00', planned_end: '2026-06-20 08:00', resource: 'Line 3 - Welding', status: 'overdue' },
    { order_no: 'WO-1007', product: 'Flange B', qty: 150, planned_start: '2026-06-23 08:00', planned_end: '2026-06-23 17:00', resource: 'Line 1 - Stamping', status: 'normal' },
    { order_no: 'WO-1008', product: 'Valve Body F', qty: 90, planned_start: '2026-06-23 10:00', planned_end: '2026-06-24 09:00', resource: 'Line 2 - Lathe', status: 'normal' },
    { order_no: 'WO-1009', product: 'Bearing Seat C', qty: 110, planned_start: '2026-06-24 08:00', planned_end: '2026-06-24 19:00', resource: 'Line 2 - Lathe', status: 'tight' },
    { order_no: 'WO-1010', product: 'Motor Case D', qty: 260, planned_start: '2026-06-20 08:00', planned_end: '2026-06-21 06:00', resource: 'Line 2 - Injection', status: 'overdue' },
    { order_no: 'WO-1011', product: 'End Cap G', qty: 500, planned_start: '2026-06-24 13:00', planned_end: '2026-06-25 15:00', resource: 'Line 3 - Assembly', status: 'normal' },
    { order_no: 'WO-1012', product: 'Bracket E', qty: 380, planned_start: '2026-06-25 08:00', planned_end: '2026-06-25 18:00', resource: 'Line 3 - Welding', status: 'tight' },
    { order_no: 'WO-1013', product: 'Gearbox A', qty: 75, planned_start: '2026-06-25 09:00', planned_end: '2026-06-26 11:00', resource: 'Line 1 - CNC', status: 'normal' },
    { order_no: 'WO-1014', product: 'Valve Body F', qty: 140, planned_start: '2026-06-18 08:00', planned_end: '2026-06-19 12:00', resource: 'Line 2 - Lathe', status: 'overdue' },
    { order_no: 'WO-1015', product: 'End Cap G', qty: 220, planned_start: '2026-06-26 08:00', planned_end: '2026-06-26 20:00', resource: 'Line 3 - Assembly', status: 'normal' },
    { order_no: 'WO-1016', product: 'Flange B', qty: 410, planned_start: '2026-06-26 13:00', planned_end: '2026-06-27 14:00', resource: 'Line 1 - Stamping', status: 'tight' },
    { order_no: 'WO-1017', product: 'Bearing Seat C', qty: 95, planned_start: '2026-06-27 08:00', planned_end: '2026-06-27 17:00', resource: 'Line 2 - Lathe', status: 'normal' },
    { order_no: 'WO-1018', product: 'Motor Case D', qty: 180, planned_start: '2026-06-27 10:00', planned_end: '2026-06-28 09:00', resource: 'Line 2 - Injection', status: 'normal' },
  ],
  urgent: [
    { order_no: 'WO-2001', product: 'Hydraulic Cylinder H', qty: 40, planned_start: '2026-06-20 06:00', planned_end: '2026-06-20 18:00', resource: 'Line 1 - CNC', status: 'overdue' },
    { order_no: 'WO-2002', product: 'Drive Shaft I', qty: 25, planned_start: '2026-06-21 07:00', planned_end: '2026-06-21 15:00', resource: 'Line 2 - Lathe', status: 'overdue' },
    { order_no: 'WO-2003', product: 'Seal Ring J', qty: 800, planned_start: '2026-06-21 08:00', planned_end: '2026-06-21 20:00', resource: 'Line 1 - Stamping', status: 'tight' },
    { order_no: 'WO-2004', product: 'Connecting Rod K', qty: 55, planned_start: '2026-06-22 08:00', planned_end: '2026-06-22 14:00', resource: 'Line 3 - Welding', status: 'tight' },
    { order_no: 'WO-2005', product: 'Pump Body L', qty: 18, planned_start: '2026-06-22 10:00', planned_end: '2026-06-23 08:00', resource: 'Line 2 - Injection', status: 'overdue' },
    { order_no: 'WO-2006', product: 'Flange B', qty: 90, planned_start: '2026-06-23 08:00', planned_end: '2026-06-23 16:00', resource: 'Line 1 - Stamping', status: 'tight' },
    { order_no: 'WO-2007', product: 'Valve Body F', qty: 32, planned_start: '2026-06-23 13:00', planned_end: '2026-06-24 10:00', resource: 'Line 2 - Lathe', status: 'normal' },
    { order_no: 'WO-2008', product: 'End Cap G', qty: 120, planned_start: '2026-06-24 08:00', planned_end: '2026-06-24 22:00', resource: 'Line 3 - Assembly', status: 'tight' },
  ],
  weekly: [
    { order_no: 'WO-3001', product: 'Housing M', qty: 160, planned_start: '2026-06-23 08:00', planned_end: '2026-06-24 17:00', resource: 'Line 2 - Injection', status: 'normal' },
    { order_no: 'WO-3002', product: 'Gear N', qty: 240, planned_start: '2026-06-23 09:00', planned_end: '2026-06-25 12:00', resource: 'Line 1 - CNC', status: 'normal' },
    { order_no: 'WO-3003', product: 'Bracket E', qty: 180, planned_start: '2026-06-24 08:00', planned_end: '2026-06-25 18:00', resource: 'Line 3 - Welding', status: 'tight' },
    { order_no: 'WO-3004', product: 'Bearing Seat C', qty: 70, planned_start: '2026-06-24 10:00', planned_end: '2026-06-25 16:00', resource: 'Line 2 - Lathe', status: 'normal' },
    { order_no: 'WO-3005', product: 'Motor Case D', qty: 130, planned_start: '2026-06-25 08:00', planned_end: '2026-06-26 14:00', resource: 'Line 2 - Injection', status: 'normal' },
    { order_no: 'WO-3006', product: 'Drive Shaft I', qty: 45, planned_start: '2026-06-25 13:00', planned_end: '2026-06-26 11:00', resource: 'Line 2 - Lathe', status: 'tight' },
    { order_no: 'WO-3007', product: 'Flange B', qty: 200, planned_start: '2026-06-26 08:00', planned_end: '2026-06-27 17:00', resource: 'Line 1 - Stamping', status: 'normal' },
    { order_no: 'WO-3008', product: 'End Cap G', qty: 310, planned_start: '2026-06-26 09:00', planned_end: '2026-06-28 10:00', resource: 'Line 3 - Assembly', status: 'normal' },
    { order_no: 'WO-3009', product: 'Gearbox A', qty: 85, planned_start: '2026-06-27 08:00', planned_end: '2026-06-28 16:00', resource: 'Line 1 - CNC', status: 'tight' },
    { order_no: 'WO-3010', product: 'Pump Body L', qty: 42, planned_start: '2026-06-27 10:00', planned_end: '2026-06-28 18:00', resource: 'Line 2 - Injection', status: 'normal' },
  ],
};

const BUILTIN_SHEETS: ScheduleSheetMeta[] = [
  { id: 'main', name: 'Main Plan', builtin: true },
  { id: 'urgent', name: 'Urgent Orders', builtin: true },
  { id: 'weekly', name: 'Weekly Plan', builtin: true },
];

interface SheetState {
  meta: ScheduleSheetMeta;
  columns: ScheduleColumnDef[];
  rows: ScheduleRowData[];
}

function cloneColumns(): ScheduleColumnDef[] {
  return DEFAULT_COLUMNS.map((c) => ({ ...c }));
}

function cloneRows(rows: SeedRow[]): ScheduleRowData[] {
  return rows.map((r) => ({ ...r }));
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
      rows: cloneRows(SEED_ROWS[meta.id] ?? []),
    });
  }
  return store;
}

let sheetStore = buildInitialStore();
let customSheetSeq = 1;
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
      if (meta.id.startsWith('custom-')) {
        const n = Number.parseInt(meta.id.replace('custom-', ''), 10);
        if (Number.isFinite(n)) customSheetSeq = Math.max(customSheetSeq, n + 1);
      }
    }
    sheetStore = next.size > 0 ? next : buildInitialStore();
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

export function createScheduleSheet(name: string): ScheduleSheetMeta | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const id = `custom-${customSheetSeq++}`;
  const meta: ScheduleSheetMeta = { id, name: trimmed, builtin: false };
  sheetStore.set(id, {
    meta,
    columns: cloneColumns(),
    rows: [],
  });
  schedulePersist(id);
  return { ...meta };
}

export function deleteScheduleSheet(sheetId: string): boolean {
  const sheet = getSheet(sheetId);
  if (!sheet || sheetStore.size <= 1) return false;
  sheetStore.delete(sheetId);
  void deleteScheduleSheetDb(sheetId).catch((e) => {
    console.error('[schedule] delete failed:', e);
  });
  return true;
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
  customSheetSeq = 1;
  await persistAll();
}
