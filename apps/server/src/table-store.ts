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
import { EventEmitter } from 'node:events';

// 'sparkline': cell holds a comma-separated numeric series ("3,5,2,…") rendered
// as an in-cell trend chart when AG-Grid Enterprise is licensed (plain text otherwise).
export type TableColumnType = 'text' | 'number' | 'status' | 'sparkline';

export interface TableColumnDef {
  key: string;
  name: string;
  width: number;
  type: TableColumnType;
  frozen?: boolean;
  deletable: boolean;
  statusOptions?: string[];
  // status columns: {value -> generic tone} from the data source (Compass etc.),
  // so badge colours are metadata-driven, not hardcoded per domain in the grid.
  semantics?: Record<string, string>;
}

export interface TableSheetMeta {
  id: string;
  name: string;
  builtin: boolean;
}

export type TableRowData = Record<string, string | number> & { row_id: string };

export type TableRowPatch = Record<string, string | number>;

/**
 * Row-level table change events for live SSE sync. Every mutator emits one, so the
 * web client can replace its 4s full-sheet poll with an EventSource + AG-Grid
 * applyTransaction (surgical updates whose cost is independent of sheet size).
 */
export type TableEvent =
  | { type: 'rowUpsert'; sheet: string; row: TableRowData }
  | { type: 'rowsDelete'; sheet: string; keys: string[] }
  | { type: 'sheetReplace'; sheet: string } // bulk import — client refetches the sheet
  | { type: 'schemaChange'; sheet: string } // column add/delete — client refetches columns
  | { type: 'sheetsChange' } // sheet create/delete — client refetches the sheet list
  // agent-requested integrated chart over sheet columns (client calls
  // AG-Grid createRangeChart; needs Enterprise — silently ignored otherwise)
  | { type: 'chart'; sheet: string; columns: string[]; chartType: string; aggFunc?: string };

const tableEvents = new EventEmitter();
tableEvents.setMaxListeners(0); // one listener per open SSE connection; no arbitrary cap

/** Subscribe to table change events (for the SSE endpoint). Returns an unsubscribe fn. */
export function onTableEvent(cb: (event: TableEvent) => void): () => void {
  tableEvents.on('change', cb);
  return () => {
    tableEvents.off('change', cb);
  };
}

function emitTable(event: TableEvent): void {
  tableEvents.emit('change', event);
}

/** Ask connected clients to render an integrated chart over sheet columns. */
export function emitTableChart(event: Extract<TableEvent, { type: 'chart' }>): void {
  emitTable(event);
}

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

// Serialize all sheet persists: the embedded SurrealDB aborts OVERLAPPING write
// transactions with "Transaction read conflict" (seen on concurrent startup seeding).
// Run every persist through one chain so they never overlap. (Our fork doesn't take
// dezhao's dedicated persist queue; this is the minimal equivalent.)
let persistChain: Promise<void> = Promise.resolve();

async function persistSheet(sheetId: string): Promise<void> {
  const next = persistChain.then(() => persistSheetInner(sheetId));
  persistChain = next.catch(() => {}); // one failure must not stall later persists
  return next;
}

async function persistSheetInner(sheetId: string): Promise<void> {
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
      semantics: c.semantics,
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
            semantics: c.semantics,
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

export function countTableRows(sheetId: string = DEFAULT_TABLE_SHEET): number {
  const sheet = getSheet(resolveTableSheetId(sheetId));
  return sheet?.rows.length ?? 0;
}

export const DEFAULT_TABLE_GET_LIMIT = 50;
export const MAX_TABLE_GET_LIMIT = 200;

/** Paginated row read for table_get — avoids multi‑MB tool payloads on large sheets. */
export function listTableRowsPage(
  sheetId: string,
  offset = 0,
  limit = DEFAULT_TABLE_GET_LIMIT,
): { totalRows: number; rows: TableRowData[] } {
  const sheet = getSheet(resolveTableSheetId(sheetId));
  if (!sheet) return { totalRows: 0, rows: [] };
  const totalRows = sheet.rows.length;
  const safeOffset = Math.max(0, Math.min(offset, totalRows));
  const safeLimit = Math.max(1, Math.min(limit, MAX_TABLE_GET_LIMIT));
  return {
    totalRows,
    rows: sheet.rows.slice(safeOffset, safeOffset + safeLimit).map((r) => ({ ...r })),
  };
}

export type TableSheetSnapshot = {
  id: string;
  name: string;
  columns: Array<{ key: string; name: string }>;
  rowCount: number;
  sampleRows: TableRowData[];
};

/** Format live table snapshots for the agent system prompt (right-panel 表格). */
export function formatTableContextBlock(snapshots: TableSheetSnapshot[]): string {
  if (snapshots.length === 0) return '';

  const lines: string[] = [
    '# Table / spreadsheet data (live snapshot)',
    'The workspace **表格** panel holds multi-sheet spreadsheet data. This is separate from the knowledge base (uploaded documents).',
    'Before saying there is no data, check this block and call `table_list_sheets` / `table_get` when row counts are non-zero.',
  ];

  for (const sheet of snapshots) {
    const colLabel = sheet.columns
      .map((c) => c.name || c.key)
      .filter(Boolean)
      .join(', ');
    lines.push(`## Sheet "${sheet.name}" (id: \`${sheet.id}\`)`);
    lines.push(
      `- ${sheet.rowCount} row(s), ${sheet.columns.length} column(s)${colLabel ? `: ${colLabel}` : ''}`,
    );
    if (sheet.sampleRows.length > 0) {
      lines.push('- Sample rows:');
      for (const row of sheet.sampleRows) {
        const keys =
          sheet.columns.length > 0
            ? sheet.columns.map((c) => c.key)
            : Object.keys(row).filter((k) => k !== 'row_id');
        const pairs = keys
          .slice(0, 5)
          .map((k) => `${k}=${String(row[k] ?? '').slice(0, 48)}`)
          .join(', ');
        lines.push(`  - \`${row.row_id}\`: ${pairs}`);
      }
    }
    lines.push(
      `- Use \`table_get\` with \`{ "sheet": "${sheet.id}", "offset": 0, "limit": 50 }\` (paginate; ${sheet.rowCount} rows total).`,
    );
  }

  return lines.join('\n');
}

/** Inject current table state so the model does not miss right-panel spreadsheet data. */
export function buildTableContextBlock(): string {
  const snapshots = listTableSheets().map((meta) => {
    const columns = listTableColumns(meta.id);
    const rows = listTableRows(meta.id);
    return {
      id: meta.id,
      name: meta.name,
      columns: columns.map((c) => ({ key: c.key, name: c.name })),
      rowCount: rows.length,
      sampleRows: rows.slice(0, 3),
    };
  });
  return formatTableContextBlock(snapshots);
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
  emitTable({ type: 'rowUpsert', sheet: resolveTableSheetId(sheetId), row: { ...sheet.rows[idx]! } });
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
  emitTable({ type: 'sheetsChange' });
  return { ...meta };
}

export async function deleteTableSheet(sheetId: string): Promise<boolean> {
  const sheet = sheetStore.get(sheetId);
  if (!sheet) return false;
  const snapshot: SheetState = {
    meta: { ...sheet.meta },
    columns: sheet.columns.map((c) => ({ ...c })),
    rows: sheet.rows.map((r) => ({ ...r })),
  };
  sheetStore.delete(sheetId);
  try {
    await deleteTableSheetDb(sheetId);
    await ensureAtLeastOneSheet();
    emitTable({ type: 'sheetsChange' });
    return true;
  } catch (e) {
    console.error('[table] delete sheet failed:', e);
    sheetStore.set(sheetId, snapshot);
    if (sheetStore.size === 0) {
      try {
        await ensureAtLeastOneSheet();
      } catch (ensureError) {
        console.error('[table] ensure default sheet after rollback failed:', ensureError);
      }
    }
    return false;
  }
}

/** After deleting the last sheet, seed a fresh default Sheet 1. */
async function ensureAtLeastOneSheet(): Promise<void> {
  if (sheetStore.size > 0) return;
  const initial = buildInitialStore();
  const main = initial.get(DEFAULT_TABLE_SHEET)!;
  sheetStore.set(DEFAULT_TABLE_SHEET, main);
  await persistSheet(DEFAULT_TABLE_SHEET);
}

export function addTableRow(sheetId: string): TableRowData | null {
  const sheet = getSheet(resolveTableSheetId(sheetId));
  if (!sheet) return null;
  const row = emptyRow();
  sheet.rows.push(row);
  tablePersist(resolveTableSheetId(sheetId));
  emitTable({ type: 'rowUpsert', sheet: resolveTableSheetId(sheetId), row: { ...row } });
  return { ...row };
}

export function deleteTableRows(sheetId: string, rowKeys: string[]): number {
  const sheet = getSheet(resolveTableSheetId(sheetId));
  if (!sheet || rowKeys.length === 0) return 0;
  const drop = new Set(rowKeys);
  const before = sheet.rows.length;
  sheet.rows = sheet.rows.filter((r) => !drop.has(tableRowKey(r)));
  tablePersist(resolveTableSheetId(sheetId));
  emitTable({ type: 'rowsDelete', sheet: resolveTableSheetId(sheetId), keys: rowKeys });
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
  emitTable({ type: 'schemaChange', sheet: resolveTableSheetId(sheetId) });
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
  emitTable({ type: 'schemaChange', sheet: resolveTableSheetId(sheetId) });
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

/**
 * Rich column descriptor from a typed source (e.g. Compass get_schedule_rows):
 * key (matches row data — kept verbatim, NOT slugified), a friendly display name,
 * type, and — for status columns — the real option set so the sanitizer keeps
 * custom statuses (derived/solved/…) and the grid can render colored badges.
 */
export interface TableColumnDescriptor {
  key: string;
  name: string;
  type: TableColumnType;
  statusOptions?: string[];
  semantics?: Record<string, string>;
}

function buildColumnsFromDescriptors(descriptors: TableColumnDescriptor[]): TableColumnDef[] {
  const columns: TableColumnDef[] = [];
  for (const d of descriptors) {
    if (!d.key) continue;
    const col: TableColumnDef = {
      key: d.key,
      name: (d.name ?? '').trim() || d.key,
      width: 110,
      type: d.type,
      deletable: true,
    };
    if (d.type === 'status' && d.statusOptions?.length) {
      col.statusOptions = [...d.statusOptions];
    }
    if (d.type === 'status' && d.semantics && Object.keys(d.semantics).length) {
      col.semantics = { ...d.semantics };
    }
    columns.push(col);
  }
  return columns;
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
  columnDescriptors?: TableColumnDescriptor[],
): { columns: TableColumnDef[]; rows: TableRowData[] } | null {
  const resolved = resolveTableSheetId(sheetId);
  const sheet = getSheet(resolved);
  if (!sheet) return null;

  const fresh = getSheet(resolved);
  if (!fresh) return null;

  // Rich descriptors (typed source like Compass) win — friendly names + status
  // options; otherwise the Excel-import path builds columns from names.
  fresh.columns = columnDescriptors?.length
    ? buildColumnsFromDescriptors(columnDescriptors)
    : buildColumnsFromNames(columnNames, columnTypes);

  fresh.rows = importedRows.map((raw) => {
    const base = emptyRow();
    const mapped = normalizeImportedRow(raw, fresh.columns);
    const clean = sanitizePatch(mapped, fresh.columns);
    return { ...base, ...clean };
  });

  tablePersist(resolved);
  emitTable({ type: 'sheetReplace', sheet: resolved });

  return {
    columns: fresh.columns.map((c) => ({ ...c })),
    rows: fresh.rows.map((r) => ({ ...r })),
  };
}

export async function resetTableStore(): Promise<void> {
  sheetStore = buildInitialStore();
  await persistAll();
}
