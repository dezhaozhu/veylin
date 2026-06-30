/**
 * Multi-sheet table store with SurrealDB persistence.
 */

import {
  countTableSheets,
  deleteTableSheet as deleteTableSheetDb,
  listTableColumns as listTableColumnsDb,
  listTableRows as listTableRowsDb,
  listTableSheets as listTableSheetsDb,
  replaceTableColumns,
  replaceTableRows,
  upsertTableSheet,
} from '@veylin/db';
import { DEFAULT_TABLE_STATUS_OPTIONS } from '@veylin/shared';

export type TableColumnType = 'text' | 'number' | 'status';

export interface TableColumnDef {
  key: string;
  name: string;
  width: number;
  type: TableColumnType;
  frozen?: boolean;
  deletable: boolean;
  statusOptions?: string[];
}

export interface TableSheetMeta {
  id: string;
  name: string;
  builtin: boolean;
}

export type TableRowData = Record<string, string | number> & { row_id: string };

export type TableRowPatch = Record<string, string | number>;

export const DEFAULT_TABLE_SHEET = 'main';

/** New sheets start with no preset columns — user adds columns as needed. */
const DEFAULT_COLUMNS: TableColumnDef[] = [];

const LEGACY_COLUMN_KEYS = [
  'order_no',
  'product',
  'qty',
  'planned_start',
  'planned_end',
  'resource',
  'status',
] as const;

const BUILTIN_SHEETS: TableSheetMeta[] = [
  { id: 'main', name: 'Sheet 1', builtin: true },
];

interface SheetState {
  meta: TableSheetMeta;
  columns: TableColumnDef[];
  rows: TableRowData[];
}

function cloneColumns(): TableColumnDef[] {
  return DEFAULT_COLUMNS.map((c) => ({ ...c }));
}

function tableRowKey(row: TableRowData): string {
  return String(row.row_id);
}

function emptyRow(): TableRowData {
  return {
    row_id: `row_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
  };
}

function isLegacyDefaultColumns(columns: TableColumnDef[]): boolean {
  if (columns.length !== LEGACY_COLUMN_KEYS.length) return false;
  return columns.every((c, i) => c.key === LEGACY_COLUMN_KEYS[i]);
}

function sheetHasNoCellData(sheet: SheetState): boolean {
  if (sheet.rows.length === 0) return true;
  return sheet.rows.every((row) =>
    sheet.columns.every((col) => {
      const v = row[col.key];
      return v === undefined || v === null || v === '';
    }),
  );
}

/** Drop unused legacy preset columns when the sheet is still empty. */
function migrateLegacyEmptySheet(sheet: SheetState): boolean {
  if (!isLegacyDefaultColumns(sheet.columns) || !sheetHasNoCellData(sheet)) return false;
  sheet.columns = [];
  sheet.rows = [];
  if (sheet.meta.builtin && sheet.meta.name === 'Main Plan') {
    sheet.meta.name = 'Sheet 1';
  }
  return true;
}

function defaultStatusOptionsForColumn(col: TableColumnDef, applyDefaults: boolean): string[] | undefined {
  if (col.type !== 'status') return undefined;
  if (col.statusOptions?.length) return col.statusOptions;
  if (!applyDefaults) return undefined;
  return [...DEFAULT_TABLE_STATUS_OPTIONS];
}

function normalizeStatusColumn(col: TableColumnDef, applyDefaults = false): TableColumnDef {
  if (col.type !== 'status') return col;
  const statusOptions = defaultStatusOptionsForColumn(col, applyDefaults);
  return statusOptions ? { ...col, statusOptions } : col;
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
let tableHydrated = false;

async function persistSheet(sheetId: string): Promise<void> {
  const sheet = sheetStore.get(sheetId);
  if (!sheet) return;
  await upsertTableSheet({ ...sheet.meta });
  await replaceTableColumns(
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
      statusOptions: c.statusOptions,
    })),
  );
  await replaceTableRows(
    sheetId,
    sheet.rows.map((r) => ({
      sheetId,
      rowKey: tableRowKey(r),
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
function tablePersist(sheetId: string): void {
  void persistSheet(sheetId).catch((e) => {
    console.error('[table] persist failed:', e);
  });
}

/** Load tables from SurrealDB or seed builtin sheets on first run. */
export async function initTableStore(): Promise<void> {
  if (tableHydrated) return;
  const count = await countTableSheets();
  if (count === 0) {
    sheetStore = buildInitialStore();
    await persistAll();
  } else {
    const sheets = await listTableSheetsDb();
    const next = new Map<string, SheetState>();
    for (const meta of sheets) {
      const columns = await listTableColumnsDb(meta.id);
      const rows = await listTableRowsDb(meta.id);
      next.set(meta.id, {
        meta,
        columns: columns.map((c) =>
          normalizeStatusColumn({
            key: c.key,
            name: c.name,
            width: c.width,
            type: c.type as TableColumnType,
            frozen: c.frozen,
            deletable: c.deletable,
            statusOptions: c.statusOptions,
          }),
        ),
        rows: rows.map((r) => ({ ...r.data } as TableRowData)),
      });
    }
    sheetStore = next;
    if (!sheetStore.has(DEFAULT_TABLE_SHEET)) {
      const initial = buildInitialStore();
      const main = initial.get(DEFAULT_TABLE_SHEET)!;
      sheetStore.set(DEFAULT_TABLE_SHEET, main);
      await persistSheet(DEFAULT_TABLE_SHEET);
    }
    let migrated = false;
    for (const sheet of sheetStore.values()) {
      if (migrateLegacyEmptySheet(sheet)) migrated = true;
    }
    if (migrated) await persistAll();
  }
  tableHydrated = true;
}

function getSheet(sheetId: string): SheetState | undefined {
  return sheetStore.get(sheetId);
}

function slugifyColumnKey(name: string, columns: TableColumnDef[]): string {
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

function isAllowedStatusValue(value: string, col: TableColumnDef): boolean {
  if (!col.statusOptions?.length) return value.length > 0;
  return col.statusOptions.includes(value);
}

function sanitizePatch(
  patch: TableRowPatch,
  columns: TableColumnDef[],
): TableRowPatch {
  const out: TableRowPatch = {};
  for (const col of columns) {
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
      const value = String(raw).trim();
      if (isAllowedStatusValue(value, col)) out[col.key] = value;
    } else {
      out[col.key] = String(raw);
    }
  }
  return out;
}

export function resolveTableSheetId(value: string | undefined): string {
  if (value && sheetStore.has(value)) return value;
  return DEFAULT_TABLE_SHEET;
}

export function listTableSheets(): TableSheetMeta[] {
  return [...sheetStore.values()].map((s) => ({ ...s.meta }));
}

export function listTableColumns(sheetId: string): TableColumnDef[] {
  const sheet = getSheet(resolveTableSheetId(sheetId));
  return sheet ? sheet.columns.map((c) => ({ ...c })) : [];
}

export function listTableRows(sheetId: string = DEFAULT_TABLE_SHEET): TableRowData[] {
  const sheet = getSheet(resolveTableSheetId(sheetId));
  return sheet ? sheet.rows.map((r) => ({ ...r })) : [];
}

export function getTableRow(rowKey: string, sheetId: string = DEFAULT_TABLE_SHEET) {
  const sheet = getSheet(resolveTableSheetId(sheetId));
  const found = sheet?.rows.find((r) => tableRowKey(r) === rowKey);
  return found ? { ...found } : undefined;
}

export async function updateTableRow(
  rowKey: string,
  patch: TableRowPatch,
  sheetId: string = DEFAULT_TABLE_SHEET,
): Promise<TableRowData | null> {
  const sheet = getSheet(resolveTableSheetId(sheetId));
  if (!sheet) return null;
  const idx = sheet.rows.findIndex((r) => tableRowKey(r) === rowKey);
  if (idx === -1) return null;
  const clean = sanitizePatch(patch, sheet.columns);
  sheet.rows[idx] = { ...sheet.rows[idx]!, ...clean };
  await persistSheet(resolveTableSheetId(sheetId));
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

export function createTableSheet(name: string): TableSheetMeta | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const id = slugifySheetId(trimmed);
  const meta: TableSheetMeta = { id, name: trimmed, builtin: false };
  sheetStore.set(id, {
    meta,
    columns: cloneColumns(),
    rows: [],
  });
  tablePersist(id);
  return { ...meta };
}

export async function deleteTableSheet(sheetId: string): Promise<boolean> {
  const sheet = sheetStore.get(sheetId);
  if (!sheet || sheet.meta.builtin || sheetId === DEFAULT_TABLE_SHEET) return false;
  sheetStore.delete(sheetId);
  try {
    await deleteTableSheetDb(sheetId);
    return true;
  } catch (e) {
    console.error('[table] delete sheet failed:', e);
    return false;
  }
}

export function addTableRow(sheetId: string): TableRowData | null {
  const sheet = getSheet(resolveTableSheetId(sheetId));
  if (!sheet) return null;
  const row = emptyRow();
  sheet.rows.push(row);
  tablePersist(resolveTableSheetId(sheetId));
  return { ...row };
}

export function deleteTableRows(sheetId: string, rowKeys: string[]): number {
  const sheet = getSheet(resolveTableSheetId(sheetId));
  if (!sheet || rowKeys.length === 0) return 0;
  const drop = new Set(rowKeys);
  const before = sheet.rows.length;
  sheet.rows = sheet.rows.filter((r) => !drop.has(tableRowKey(r)));
  tablePersist(resolveTableSheetId(sheetId));
  return before - sheet.rows.length;
}

export function addTableColumn(sheetId: string, name: string): TableColumnDef | null {
  const sheet = getSheet(resolveTableSheetId(sheetId));
  const trimmed = name.trim();
  if (!sheet || !trimmed) return null;
  const type = inferColumnType(trimmed);
  const col: TableColumnDef = normalizeStatusColumn({
    key: slugifyColumnKey(trimmed, sheet.columns),
    name: trimmed,
    width: 110,
    type,
    deletable: true,
  }, true);
  sheet.columns.push(col);
  tablePersist(resolveTableSheetId(sheetId));
  return { ...col };
}

export function deleteTableColumn(sheetId: string, columnKey: string): boolean {
  const sheet = getSheet(resolveTableSheetId(sheetId));
  if (!sheet) return false;
  const col = sheet.columns.find((c) => c.key === columnKey);
  if (!col || !col.deletable) return false;
  sheet.columns = sheet.columns.filter((c) => c.key !== columnKey);
  for (const row of sheet.rows) {
    delete row[columnKey];
  }
  tablePersist(resolveTableSheetId(sheetId));
  return true;
}

function normalizeImportedRow(
  raw: TableRowPatch,
  columns: TableColumnDef[],
): TableRowPatch {
  const out: TableRowPatch = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === 'row_id') continue;
    const col =
      columns.find((c) => c.key === k) ?? columns.find((c) => c.name === k);
    if (col) out[col.key] = v;
  }
  return out;
}

function inferColumnType(name: string): TableColumnType {
  const lower = name.trim().toLowerCase();
  if (lower === 'status' || lower === '状态') return 'status';
  return 'text';
}

function buildColumnsFromNames(
  names: string[],
  types?: Record<string, TableColumnType>,
): TableColumnDef[] {
  const columns: TableColumnDef[] = [];
  for (const rawName of names) {
    const name = rawName.trim();
    if (!name) continue;
    columns.push(
      normalizeStatusColumn({
        key: slugifyColumnKey(name, columns),
        name,
        width: 110,
        // caller-provided type (e.g. from a typed source like get_schedule_rows)
        // wins; fall back to name-based inference (the Excel-import path).
        type: types?.[rawName] ?? types?.[name] ?? inferColumnType(name),
        deletable: true,
      }, true),
    );
  }
  return columns;
}

/** Replace sheet columns and rows from an Excel import. */
export function importTableSheet(
  sheetId: string,
  columnNames: string[],
  importedRows: TableRowPatch[],
  columnTypes?: Record<string, TableColumnType>,
): { columns: TableColumnDef[]; rows: TableRowData[] } | null {
  const resolved = resolveTableSheetId(sheetId);
  const sheet = getSheet(resolved);
  if (!sheet) return null;

  const fresh = getSheet(resolved);
  if (!fresh) return null;

  fresh.columns = buildColumnsFromNames(columnNames, columnTypes);

  fresh.rows = importedRows.map((raw) => {
    const base = emptyRow();
    const mapped = normalizeImportedRow(raw, fresh.columns);
    const clean = sanitizePatch(mapped, fresh.columns);
    return { ...base, ...clean };
  });

  tablePersist(resolved);

  return {
    columns: fresh.columns.map((c) => ({ ...c })),
    rows: fresh.rows.map((r) => ({ ...r })),
  };
}

export async function resetTableStore(): Promise<void> {
  sheetStore = buildInitialStore();
  await persistAll();
}
