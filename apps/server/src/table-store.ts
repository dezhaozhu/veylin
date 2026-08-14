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
  type TableSheetSource,
} from '@veylin/db';
import { DEFAULT_TABLE_STATUS_OPTIONS, type Project } from '@veylin/shared';
import { EventEmitter } from 'node:events';
import { legacyServerToProjectId } from './project-migration.js';
import { planScopeBackfill } from './table-scope-backfill.js';
import {
  PERSONAL_SCOPE,
  sameScope,
  scopeOfSheetId,
  sheetIdFor,
  shortNameOf,
  threadScope,
  projectScope,
  type SheetScope,
} from './table-scope.js';

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
  /**
   * 归属:这张表是谁的 context —— 个人 / 某项目 / 某对话。
   * 见 table-scope.ts 与 docs/specs/2026-08-13-table-scope-context.md。
   * 迁移期可能缺失(老库里的表尚未回填),缺失 = 还没归属,由回填决定。
   */
  scope?: SheetScope;
  /** @deprecated 老字段,迁移期只用于回填 scope;新代码一律读 `scope`。 */
  threadId?: string | null;
  /**
   * Load provenance: which MCP server (+ tenant, when the payload carried one) the
   * sheet's data was last (re)loaded from, and when. Absent/null on sheets that
   * predate this field or were never loaded via a Compass load tool ("legacy
   * unstamped" — table_get surfaces a distinct warning for those under a project pin).
   */
  source?: TableSheetSource | null;
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

// 默认表归**个人区**:进到一个项目里是空态,直到装载或导入。项目里不该凭空
// 有一张我个人的空表(spec §3.5)。
const BUILTIN_SHEETS: TableSheetMeta[] = [
  {
    id: sheetIdFor(PERSONAL_SCOPE, DEFAULT_TABLE_SHEET),
    name: 'Sheet 1',
    builtin: true,
    scope: PERSONAL_SCOPE,
  },
];

interface SheetState {
  meta: TableSheetMeta;
  columns: TableColumnDef[];
  rows: TableRowData[];
}

function cloneColumns(): TableColumnDef[] {
  return DEFAULT_COLUMNS.map((c) => ({ ...c }));
}

export function tableRowKey(row: TableRowData): string {
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
        // 落库的 scope 是宽松形状({kind:string, id?}),读回来收窄成 SheetScope;
        // 认不出的形状按"还没归属"处理,交给回填。
        meta: { ...meta, scope: narrowScope(meta.scope) },
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
    // 归属回填(spec §3.6):老表没有 scope、id 也没有前缀。改 id 要级联
    // columns/rows —— 内存里"删旧键写新键",再整体 persistAll 落盘。
    const plan = planScopeBackfill([...sheetStore.values()].map((x) => x.meta));
    if (plan.length) {
      for (const entry of plan) {
        const state = sheetStore.get(entry.from);
        if (!state) continue;
        sheetStore.delete(entry.from);
        state.meta = { ...state.meta, id: entry.to, scope: entry.scope, threadId: undefined };
        sheetStore.set(entry.to, state);
      }
      console.info(`[table] 归属回填:${plan.length} 张表 —— `
        + plan.map((e) => `${e.from} → ${e.to}`).join(', '));
      for (const entry of plan) await deleteTableSheetDb(entry.from);
      await persistAll();
    }
    const mainId = sheetIdFor(PERSONAL_SCOPE, DEFAULT_TABLE_SHEET);
    if (!sheetStore.has(mainId)) {
      const initial = buildInitialStore();
      sheetStore.set(mainId, initial.get(mainId)!);
      await persistSheet(mainId);
    }
    let migrated = false;
    for (const sheet of sheetStore.values()) {
      if (migrateLegacyEmptySheet(sheet)) migrated = true;
    }
    if (migrated) await persistAll();
  }
  tableHydrated = true;
}

/** 库里的宽松 scope → SheetScope;认不出返回 undefined(交给回填,不猜)。 */
function narrowScope(raw: { kind: string; id?: string } | null | undefined): SheetScope | undefined {
  if (!raw) return undefined;
  if (raw.kind === 'personal') return PERSONAL_SCOPE;
  if (raw.kind === 'project' && raw.id) return projectScope(raw.id);
  if (raw.kind === 'thread' && raw.id) return threadScope(raw.id);
  return undefined;
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

function findColumn(
  columns: TableColumnDef[],
  field: string,
): TableColumnDef | undefined {
  return columns.find((c) => c.key === field) ?? columns.find((c) => c.name === field);
}

export type RejectedPatchField = {
  /** Original key from the patch (may be display name). */
  field: string;
  columnKey?: string;
  reason: string;
};

export type SanitizePatchResult = {
  applied: TableRowPatch;
  rejected: RejectedPatchField[];
};

/**
 * Map a patch onto column keys (accepts key or display name).
 * Invalid number/status values are rejected with reasons — never silently dropped.
 */
export function sanitizePatch(
  patch: TableRowPatch,
  columns: TableColumnDef[],
): SanitizePatchResult {
  const applied: TableRowPatch = {};
  const rejected: RejectedPatchField[] = [];

  for (const [field, raw] of Object.entries(patch)) {
    if (field === 'row_id') continue;
    const col = findColumn(columns, field);
    if (!col) {
      rejected.push({ field, reason: `Unknown column "${field}"` });
      continue;
    }
    // 上游 JSON 的 null = 这件事还没发生(如未开工的"实际开始")。落成空,不落成
    // 字面量 "null",更不能落成 Number(null)=0 —— 那是凭空造出来的值。
    if (raw === null) {
      applied[col.key] = '';
      continue;
    }
    if (col.type === 'number') {
      if (raw === '' || raw === undefined) {
        applied[col.key] = '';
        continue;
      }
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        rejected.push({
          field,
          columnKey: col.key,
          reason: `Invalid number value "${String(raw)}" for column "${col.name || col.key}"`,
        });
        continue;
      }
      applied[col.key] = n;
    } else if (col.type === 'status') {
      if (raw === '' || raw === undefined) {
        applied[col.key] = '';
        continue;
      }
      const value = String(raw).trim();
      if (!isAllowedStatusValue(value, col)) {
        const allowed = col.statusOptions?.length
          ? col.statusOptions.join(', ')
          : '(any non-empty string)';
        rejected.push({
          field,
          columnKey: col.key,
          reason: `Invalid status value "${value}" for column "${col.name || col.key}"; allowed: ${allowed}`,
        });
        continue;
      }
      applied[col.key] = value;
    } else {
      applied[col.key] = String(raw);
    }
  }

  return { applied, rejected };
}

/** 这张表归谁。迁移期缺 `scope` 时从 id 前缀反推,再退回个人区。 */
export function scopeOfSheet(meta: TableSheetMeta): SheetScope {
  return meta.scope ?? scopeOfSheetId(meta.id) ?? PERSONAL_SCOPE;
}

/**
 * 入口解析:短名(`schedule`)或内部 id → 本作用域内的内部 id。
 *
 * **跨作用域的 id 不被原样接受** —— 拿着 guolu 的 id 在上重的会话里查,应当解析
 * 不到,而不是把别人的表端出来(spec §3.2)。解析不到时落回本作用域的默认表,
 * 由调用方按存在与否决定后续。
 */
export function resolveTableSheetId(value: string | undefined, scope: SheetScope): string {
  const fallback = sheetIdFor(scope, DEFAULT_TABLE_SHEET);
  if (!value) return fallback;
  if (sheetStore.has(value)) {
    return sheetBelongsToScope(value, scope) ? value : fallback;
  }
  // 短名:在本作用域里找同名的表
  const byShortName = sheetIdFor(scope, value);
  if (sheetStore.has(byShortName)) return byShortName;
  return fallback;
}

/**
 * 写入用的解析:缺省 → 本作用域的默认表(存在才给);显式给了但找不到 → null
 * (不静默写到默认表去)。
 */
export function tryResolveTableSheetId(
  value: string | undefined,
  scope: SheetScope,
): string | null {
  if (value === undefined || value === '') {
    const id = sheetIdFor(scope, DEFAULT_TABLE_SHEET);
    return sheetStore.has(id) ? id : null;
  }
  if (sheetStore.has(value)) return sheetBelongsToScope(value, scope) ? value : null;
  const byShortName = sheetIdFor(scope, value);
  return sheetStore.has(byShortName) ? byShortName : null;
}

/** 内部用:只按 id 取,不问作用域(mutator 拿到的已经是解析过的 id)。 */
function existingSheetId(sheetId: string): string | null {
  return sheetStore.has(sheetId) ? sheetId : null;
}

/**
 * 列出某作用域的表。**层与层之间不串**:个人区看不到项目的,项目也看不到个人的
 * (spec §1)。不传 scope = 全部(仅供迁移/运维,不要用在请求路径上)。
 */
export function listTableSheets(scope?: SheetScope): TableSheetMeta[] {
  const all = [...sheetStore.values()].map((s) => ({ ...s.meta }));
  if (!scope) return all;
  return all.filter((s) => sameScope(scopeOfSheet(s), scope));
}

export function getTableSheetMeta(sheetId: string): TableSheetMeta | undefined {
  const id = existingSheetId(sheetId);
  if (!id) return undefined;
  const sheet = getSheet(id);
  return sheet ? { ...sheet.meta } : undefined;
}

/**
 * Hard-mismatch predicate (Layer-4 provenance, audit fix #2): true only when
 * the sheet carries a STAMPED source that names a different project than the
 * thread's pin. Legacy unstamped sheets (`source` absent) are deliberately
 * excluded here — they keep the softer "本表无来源记录" warning instead of a
 * refusal, since refusing all pre-provenance data under any pin would be too
 * aggressive (see `buildProvenanceWarning` in table-tools.ts). Shared by
 * `table_get` (refuses rows outright) and `buildTableContextBlock` (omits the
 * sheet's data from the injected prompt block) so both surfaces agree.
 *
 * PROJECT-PIN RE-KEY (v3, Phase B 5c — plan risk #1, the highest of the
 * phase): both sides of the comparison are PROJECT ids now. `projectPin` is
 * the thread's pinned project id; the sheet's identity is
 * `source.project` — stamped by the Compass load tools with the pinned
 * project's id, NEVER the resolved toolset key (every project resolves the
 * same `'compass'` key post-v3, so stamping the key would make every
 * project's stamp identical and blind this check entirely). Legacy
 * pre-migration stamps carry only `source.server` (an old entry name like
 * `compass-guolu`): they are mapped through the permanent
 * `legacyServerToProjectId` shim against the tenant's project rows
 * (`projects`, threaded in by the caller). A stamped source that maps to NO
 * project — foreign server, unknown source, or the caller supplied no
 * project rows — is a positive "not this pin's project" and hard-refuses,
 * exactly like the pre-re-key `server !== pin` comparison did (fail-closed).
 */
export function isProjectPinMismatch(
  source: TableSheetSource | null | undefined,
  projectPin: string | null | undefined,
  projects: Project[] = [],
): boolean {
  if (!projectPin) return false;
  if (!source?.project && !source?.server) return false; // unstamped → soft-warning path
  const sourceProject = source.project ?? legacyServerToProjectId(source.server, projects);
  return sourceProject !== projectPin;
}

/**
 * G1 predicate (2026-08-12): a sheet carrying ANY load stamp is PROJECT data —
 * it came out of a Compass server under some project. A turn with no project
 * pin (the「个人」area, or a tool call outside a chat turn) has no project in
 * scope at all, so that data is out of scope here exactly as the grouped MCP
 * servers and the widget channel already are (`resolveScopedServerNames` denies
 * grouped members without an active pin).
 *
 * This is the structural half of G1: the system-prompt line telling the model
 * it is unpinned has existed since 全项目制 (chat.ts `buildProjectPinBlock`),
 * and the grounding experiment measured prose to have no effect — the model
 * read the stale project sheet anyway and narrated a whole analysis off it.
 * Withholding the rows is not advice the model can decline.
 *
 * Deliberately NOT symmetric with `isProjectPinMismatch`: unstamped sheets stay
 * readable (they are the user's own uploads — the personal area's whole point),
 * and under a pin this returns false so the mismatch predicate keeps owning
 * that decision. One fact, one owner.
 */
export function isUnscopedProjectData(
  source: TableSheetSource | null | undefined,
  projectPin: string | null | undefined,
): boolean {
  if (projectPin) return false;
  return Boolean(source?.project || source?.server);
}

/**
 * Stamp (or refresh) a sheet's load provenance. Called by the Compass load tools
 * on every (re)load — sheetId must already exist (callers create the sheet first).
 * Awaits the persist (unlike the fire-and-forget row/column mutators) so a caller
 * that reads the sheet back right after stamping — e.g. a reload-from-DB test —
 * observes it deterministically.
 */
export async function stampTableSheetSource(
  sheetId: string,
  source: TableSheetSource,
): Promise<TableSheetMeta | null> {
  const sheet = getSheet(sheetId);
  if (!sheet) return null;
  sheet.meta = { ...sheet.meta, source };
  await persistSheet(sheetId);
  return { ...sheet.meta };
}

/**
 * 归属判定。**没有"全局可见"这一档** —— 以前 threadId=null 的表谁都看得见,
 * 那正是个人区能看到项目排产数据的原因(spec §0 ②)。
 */
export function sheetBelongsToScope(sheetId: string, scope: SheetScope): boolean {
  const meta = getTableSheetMeta(sheetId);
  if (!meta) return false;
  return sameScope(scopeOfSheet(meta), scope);
}

export function listTableColumns(sheetId: string): TableColumnDef[] {
  const sheet = getSheet(existingSheetId(sheetId) ?? sheetId);
  return sheet ? sheet.columns.map((c) => ({ ...c })) : [];
}

export function listTableRows(sheetId: string = sheetIdFor(PERSONAL_SCOPE, DEFAULT_TABLE_SHEET)): TableRowData[] {
  const sheet = getSheet(existingSheetId(sheetId) ?? sheetId);
  return sheet ? sheet.rows.map((r) => ({ ...r })) : [];
}

export function countTableRows(sheetId: string = DEFAULT_TABLE_SHEET): number {
  const sheet = getSheet(existingSheetId(sheetId) ?? sheetId);
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
  const sheet = getSheet(existingSheetId(sheetId) ?? sheetId);
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
  /** True when `isProjectPinMismatch` fired for this sheet — the block omits
   * its data (name only, one-line note) instead of leaking cross-project rows
   * into the system prompt. */
  pinMismatch?: boolean;
  /** True when `isUnscopedProjectData` fired (G1): stamped project data in a
   * turn with no project pin. Same withholding as `pinMismatch`, different
   * reason and different fix, so it gets its own note. Mutually exclusive with
   * `pinMismatch` by construction (that one requires a pin). */
  unscopedProjectData?: boolean;
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
    if (sheet.pinMismatch) {
      lines.push(
        `## Sheet "${sheet.name}" (id: \`${sheet.id}\`) — 跳过: 数据来源与当前项目不一致, 请在当前项目下重新加载`,
      );
      continue;
    }
    if (sheet.unscopedProjectData) {
      lines.push(
        `## Sheet "${sheet.name}" (id: \`${sheet.id}\`) — 跳过: 本表是项目数据, 当前会话未绑定项目, ` +
          `不能作为依据; 请将会话移动到该项目, 或在该项目下新建会话`,
      );
      continue;
    }
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

/**
 * Inject current table state so the model does not miss right-panel spreadsheet
 * data. `projectPin` lets a mismatched sheet (audit fix #2) be omitted from the
 * injected block the same way `table_get` refuses its rows. `projects` (the
 * tenant's project rows, threaded from routes/chat.ts) feeds the legacy-stamp
 * shim inside `isProjectPinMismatch` — omitting it under a pin makes every
 * legacy-stamped sheet read as mismatched (fail-closed, never a leak).
 */
export function buildTableContextBlock(
  scope: SheetScope,
  projectPin?: string | null,
  projects: Project[] = [],
): string {
  const snapshots = listTableSheets(scope).map((meta) => {
    const pinMismatch = isProjectPinMismatch(meta.source, projectPin, projects);
    // G1: withheld for the other reason — project data, no project pinned.
    const unscopedProjectData = isUnscopedProjectData(meta.source, projectPin);
    const withheld = pinMismatch || unscopedProjectData;
    const columns = withheld ? [] : listTableColumns(meta.id);
    const rows = withheld ? [] : listTableRows(meta.id);
    return {
      id: meta.id,
      name: meta.name,
      columns: columns.map((c) => ({ key: c.key, name: c.name })),
      rowCount: rows.length,
      sampleRows: rows.slice(0, 3),
      pinMismatch,
      unscopedProjectData,
    };
  });
  return formatTableContextBlock(snapshots);
}

export function getTableRow(rowKey: string, sheetId: string = DEFAULT_TABLE_SHEET) {
  const sheet = getSheet(existingSheetId(sheetId) ?? sheetId);
  const found = sheet?.rows.find((r) => tableRowKey(r) === rowKey);
  return found ? { ...found } : undefined;
}

export async function updateTableRow(
  rowKey: string,
  patch: TableRowPatch,
  sheetId: string = DEFAULT_TABLE_SHEET,
): Promise<TableRowData | null> {
  const sheet = getSheet(existingSheetId(sheetId) ?? sheetId);
  if (!sheet) return null;
  const idx = sheet.rows.findIndex((r) => tableRowKey(r) === rowKey);
  if (idx === -1) return null;
  const clean = sanitizePatch(patch, sheet.columns).applied;
  sheet.rows[idx] = { ...sheet.rows[idx]!, ...clean };
  await persistSheet(existingSheetId(sheetId) ?? sheetId);
  emitTable({ type: 'rowUpsert', sheet: existingSheetId(sheetId) ?? sheetId, row: { ...sheet.rows[idx]! } });
  return { ...sheet.rows[idx]! };
}

export type TableRowUpdate = {
  rowKey: string;
  patch: TableRowPatch;
};

export type UpdateTableRowsResult =
  | {
      ok: true;
      sheet: string;
      rows: TableRowData[];
      results: Array<{
        rowKey: string;
        row: TableRowData;
        applied: TableRowPatch;
        previous: TableRowPatch;
        rejected: RejectedPatchField[];
      }>;
    }
  | {
      ok: false;
      sheet: string;
      rows: TableRowData[];
      results: [];
      rejected: RejectedPatchField[];
      message: string;
    };

/**
 * Atomic multi-row cell update: validate all first, then apply + one persist.
 * Emits one `rowUpsert` per changed row (same SSE shape as single-row writes).
 */
export async function updateTableRows(
  updates: readonly TableRowUpdate[],
  sheetId: string = DEFAULT_TABLE_SHEET,
): Promise<UpdateTableRowsResult> {
  if (updates.length === 0) {
    return {
      ok: false,
      sheet: sheetId,
      rows: [],
      results: [],
      rejected: [],
      message: 'rows must contain at least one update',
    };
  }

  // 到这里 sheetId 已经是解析过的内部 id;短名 `main` 是历史调用留下的宽容。
  const effectiveSheetId = sheetStore.has(sheetId)
    ? sheetId
    : sheetId === DEFAULT_TABLE_SHEET
      ? tryResolveTableSheetId(undefined, PERSONAL_SCOPE)
      : null;

  if (!effectiveSheetId) {
    return {
      ok: false,
      sheet: sheetId,
      rows: [],
      results: [],
      rejected: [],
      message: `Sheet "${sheetId}" not found`,
    };
  }

  const sheet = getSheet(effectiveSheetId);
  if (!sheet) {
    return {
      ok: false,
      sheet: effectiveSheetId,
      rows: [],
      results: [],
      rejected: [],
      message: `Sheet "${effectiveSheetId}" not found`,
    };
  }

  type Planned = {
    idx: number;
    rowKey: string;
    applied: TableRowPatch;
    previous: TableRowPatch;
    rejected: RejectedPatchField[];
    current: TableRowData;
  };
  const planned: Planned[] = [];

  for (const update of updates) {
    const rowKey = String(update.rowKey ?? '').trim();
    if (!rowKey) {
      return {
        ok: false,
        sheet: effectiveSheetId,
        rows: [],
        results: [],
        rejected: [],
        message: 'row_key is required',
      };
    }
    const idx = sheet.rows.findIndex((r) => tableRowKey(r) === rowKey);
    if (idx === -1) {
      return {
        ok: false,
        sheet: effectiveSheetId,
        rows: [],
        results: [],
        rejected: [{ field: rowKey, reason: `Row ${rowKey} not found` }],
        message: `Row ${rowKey} not found`,
      };
    }
    const current = sheet.rows[idx]!;
    const { applied, rejected } = sanitizePatch(update.patch, sheet.columns);
    const hasApplied = Object.keys(applied).length > 0;
    const requested = Object.keys(update.patch).filter((k) => k !== 'row_id');
    const previous: TableRowPatch = {};
    for (const key of Object.keys(applied)) {
      const prev = current[key];
      previous[key] = prev === undefined ? '' : prev;
    }
    if (requested.length > 0 && !hasApplied) {
      return {
        ok: false,
        sheet: effectiveSheetId,
        rows: [],
        results: [],
        rejected:
          rejected.length > 0
            ? rejected
            : [{ field: rowKey, reason: 'No fields applied' }],
        message: rejected.map((r) => r.reason).join('; ') || 'No fields applied',
      };
    }
    planned.push({ idx, rowKey, applied, previous, rejected, current });
  }

  const results: Array<{
    rowKey: string;
    row: TableRowData;
    applied: TableRowPatch;
    previous: TableRowPatch;
    rejected: RejectedPatchField[];
  }> = [];
  let anyApplied = false;

  for (const item of planned) {
    if (Object.keys(item.applied).length > 0) {
      sheet.rows[item.idx] = { ...item.current, ...item.applied };
      anyApplied = true;
    }
    results.push({
      rowKey: item.rowKey,
      row: { ...sheet.rows[item.idx]! },
      applied: item.applied,
      previous: item.previous,
      rejected: item.rejected,
    });
  }

  if (anyApplied) {
    tablePersist(effectiveSheetId);
    for (const item of results) {
      if (Object.keys(item.applied).length > 0) {
        emitTable({
          type: 'rowUpsert',
          sheet: effectiveSheetId,
          row: { ...item.row },
        });
      }
    }
  }

  return {
    ok: true,
    sheet: effectiveSheetId,
    rows: results.map((r) => r.row),
    results,
  };
}

/** \u663e\u793a\u540d \u2192 \u77ed\u540d(\u4e0d\u5e26\u4f5c\u7528\u57df\u524d\u7f00);\u540c\u4f5c\u7528\u57df\u5185\u649e\u4e86\u5c31\u52a0\u5e8f\u53f7\u3002 */
function slugifySheetShortName(name: string, scope: SheetScope): string {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_\u4e00-\u9fff-]/g, '') || 'sheet';
  let short = base;
  let n = 1;
  while (sheetStore.has(sheetIdFor(scope, short))) {
    short = `${base}_${n++}`;
  }
  return short;
}

/** Display-name key for uniqueness (trim + case-insensitive). */
function sheetNameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** 同作用域内是否已有同名表(去空白、不分大小写)。跨作用域同名是两张表。 */
export function isTableSheetNameTaken(
  name: string,
  excludeSheetId: string | undefined,
  scope: SheetScope,
): boolean {
  const key = sheetNameKey(name);
  if (!key) return false;
  for (const other of sheetStore.values()) {
    if (excludeSheetId && other.meta.id === excludeSheetId) continue;
    if (!sameScope(scopeOfSheet(other.meta), scope)) continue;
    if (sheetNameKey(other.meta.name) === key) return true;
  }
  return false;
}

export function createTableSheet(name: string, scope: SheetScope): TableSheetMeta | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (isTableSheetNameTaken(trimmed, undefined, scope)) return null;
  const id = sheetIdFor(scope, slugifySheetShortName(trimmed, scope));
  const meta: TableSheetMeta = {
    id,
    name: trimmed,
    builtin: false,
    scope,
  };
  sheetStore.set(id, {
    meta,
    columns: cloneColumns(),
    rows: [],
  });
  tablePersist(id);
  emitTable({ type: 'sheetsChange' });
  return { ...meta };
}

/** Rename a sheet's display name. Sheet id stays stable so tool/API references keep working. */
export function renameTableSheet(sheetId: string, name: string): TableSheetMeta | null {
  const sheet = sheetStore.get(sheetId);
  if (!sheet) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (sheet.meta.name === trimmed) return { ...sheet.meta };
  if (isTableSheetNameTaken(trimmed, sheetId, scopeOfSheet(sheet.meta))) return null;
  sheet.meta = { ...sheet.meta, name: trimmed };
  tablePersist(sheetId);
  emitTable({ type: 'sheetsChange' });
  return { ...sheet.meta };
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
async function ensureAtLeastOneSheet(scope: SheetScope = PERSONAL_SCOPE): Promise<void> {
  // "至少一张"是**按作用域**算的:项目里删光了不该冒出一张个人的空表来
  // (spec §3.5)。个人区是唯一有内建默认表的作用域。
  if (listTableSheets(scope).length > 0) return;
  if (!sameScope(scope, PERSONAL_SCOPE)) return;
  const id = sheetIdFor(PERSONAL_SCOPE, DEFAULT_TABLE_SHEET);
  const initial = buildInitialStore();
  sheetStore.set(id, initial.get(id)!);
  await persistSheet(id);
}

export function addTableRow(sheetId: string): TableRowData | null {
  const sheet = getSheet(existingSheetId(sheetId) ?? sheetId);
  if (!sheet) return null;
  const row = emptyRow();
  sheet.rows.push(row);
  tablePersist(existingSheetId(sheetId) ?? sheetId);
  emitTable({ type: 'rowUpsert', sheet: existingSheetId(sheetId) ?? sheetId, row: { ...row } });
  return { ...row };
}

/** Snapshot of a row removed by deleteTableRows, for transcript rewind restore. */
export type DeletedTableRowSnapshot = {
  index: number;
  row: TableRowData;
};

export type DeleteTableRowsResult = {
  removed: number;
  rows: DeletedTableRowSnapshot[];
};

export function deleteTableRows(
  sheetId: string,
  rowKeys: string[],
): DeleteTableRowsResult {
  const sheet = getSheet(existingSheetId(sheetId) ?? sheetId);
  if (!sheet || rowKeys.length === 0) return { removed: 0, rows: [] };
  const drop = new Set(rowKeys);
  const removedRows: DeletedTableRowSnapshot[] = [];
  for (let i = 0; i < sheet.rows.length; i++) {
    const row = sheet.rows[i]!;
    if (drop.has(tableRowKey(row))) {
      removedRows.push({ index: i, row: { ...row } });
    }
  }
  if (removedRows.length === 0) return { removed: 0, rows: [] };
  sheet.rows = sheet.rows.filter((r) => !drop.has(tableRowKey(r)));
  const effectiveId = existingSheetId(sheetId) ?? sheetId;
  tablePersist(effectiveId);
  emitTable({
    type: 'rowsDelete',
    sheet: effectiveId,
    keys: removedRows.map((s) => tableRowKey(s.row)),
  });
  return { removed: removedRows.length, rows: removedRows };
}

export function addTableColumn(sheetId: string, name: string): TableColumnDef | null {
  const sheet = getSheet(existingSheetId(sheetId) ?? sheetId);
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
  tablePersist(existingSheetId(sheetId) ?? sheetId);
  emitTable({ type: 'schemaChange', sheet: existingSheetId(sheetId) ?? sheetId });
  return { ...col };
}

export function deleteTableColumn(sheetId: string, columnKey: string): boolean {
  const sheet = getSheet(existingSheetId(sheetId) ?? sheetId);
  if (!sheet) return false;
  const col = sheet.columns.find((c) => c.key === columnKey);
  if (!col || !col.deletable) return false;
  sheet.columns = sheet.columns.filter((c) => c.key !== columnKey);
  for (const row of sheet.rows) {
    delete row[columnKey];
  }
  tablePersist(existingSheetId(sheetId) ?? sheetId);
  emitTable({ type: 'schemaChange', sheet: existingSheetId(sheetId) ?? sheetId });
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
  const resolved = existingSheetId(sheetId) ?? sheetId;
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
    const clean = sanitizePatch(mapped, fresh.columns).applied;
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
  // 内存是权威,落盘失败不该让 reset 本身失败(与其它 mutator 的
  // fire-and-forget 落盘同一条容忍);没有配 DB 的场景也能用。
  try {
    await persistAll();
  } catch (e) {
    console.error('[table] reset persist failed:', e);
  }
}
