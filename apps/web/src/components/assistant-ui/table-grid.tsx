import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { decideCompassLoad } from '@/lib/compass-schedule-load';
import { shouldApplyPayload } from '@/lib/sheet-payload-guard';
import {
  TABLE_GRID_FILL_CHUNK,
  TABLE_GRID_FIRST_PAGE,
  shouldWaitForMoreRows,
  tableFillOffset,
} from '@/lib/table-progressive-load';
import { consumeSheetSelection } from '@/lib/pending-sheet-selection';
import { columnToReveal } from '@/lib/new-columns';
import { isStaleSheetError } from '@/lib/stale-sheet-recovery';
import { panelScopeKey } from '@/lib/panel-scope-key';
import { findSheetIdByShortName, isSheet } from '@/lib/sheet-short-name';
import { useProjectsOrNull } from '@/lib/projects-sync';
import { useThreadProjectsOrNull } from '@/lib/thread-projects-sync';
import { createPortal } from 'react-dom';
import { useAuiState } from '@assistant-ui/react';
import { useAui } from '@assistant-ui/store';
import { Plus, ChevronDown, ChevronUp, Minus, Redo2, Undo2, Upload, Download, X, Loader2, Search, AtSign, Camera, FolderPlus } from 'lucide-react';
import { AgGridReact } from 'ag-grid-react';
import { placeComposerCaret } from '@/lib/composer-caret';
import { appendSelectionToken, registerTableSelection } from '@/lib/table-selection-ref';
import {
  type ColDef,
  type GetRowIdParams,
  type ValueFormatterParams,
  type ICellRendererParams,
  type CellClassParams,
  type CellValueChangedEvent,
  type CellKeyDownEvent,
  type SelectionChangedEvent,
  type CellClickedEvent,
  type IHeaderParams,
  type GridApi,
  type GridReadyEvent,
  type IRowNode,
  themeQuartz,
} from 'ag-grid-community';
import { anchorOfRow, pickLocateRows, type LocateTarget } from '@/lib/grain-anchor';
import { carryViewAcrossGrain } from '@/lib/grain-view-carry';
import { revealPath } from '@/lib/project-folder';
import { askBubbleAction, resolveSelectionScope, type SelectionScope } from '@/lib/grid-selection-scope';
import './ag-grid-modules';
import { hasProEntitlement } from '@/lib/ag-grid-license';
import { isAgGridEnterpriseReady } from '@/lib/ag-grid-enterprise-state';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { exportTableToExcel, parseTableExcelFile } from '@/lib/table-excel';
import { buildGovernedEditBody, GOVERNED_EDIT_FIELDS } from '@/lib/schedule-edit';
import { usePanelTabs } from '@/components/assistant-ui/right-panel/panel-tabs-context';
import { isLateOnlyGridFilter, type OpenGridFilter } from '@/lib/correction-bridge';
import { useRightSidebar } from '@/components/ui/sidebar';
import {
  hasGantt,
  locateGantt,
  placeJobIdAfterOrderId,
  scheduleLocateFromDate,
  shouldLocateGanttFromTableClick,
} from '@/lib/schedule-locate';
import { DEFAULT_TABLE_STATUS_OPTIONS } from '@veylin/shared';

type TableColumnType = 'text' | 'number' | 'status' | 'sparkline';

type TableRow = Record<string, string | number> & { row_id?: string };

function rowKey(row: TableRow): string {
  return String(row.row_id ?? '');
}

// Live-sync events pushed over SSE from /api/table/stream (mirrors the server's
// TableEvent union). Applied as row-level deltas so update cost is independent of
// sheet size — the whole reason the 4s full-sheet poll is gone.
type TableEvent =
  | { type: 'rowUpsert'; sheet: string; row: TableRow }
  | { type: 'rowsDelete'; sheet: string; keys: string[] }
  | { type: 'sheetReplace'; sheet: string }
  | { type: 'schemaChange'; sheet: string }
  | { type: 'sheetsChange' }
  | { type: 'chart'; sheet: string; columns: string[]; chartType: string; aggFunc?: string };

// ── 二三级 master-detail (Pro / AG-Grid Enterprise) ──────────────────────────
// The schedule sheet's 二级 rows expand to their 三级 (设备级) ops, fetched on
// demand from /api/schedule-detail (→ Compass get_workorder_rows). Read-only.
const EMPTY_RANGE: SelectionScope = { rowKeys: [], columns: [] };
// **短名**,不是面板拿到的 id —— 项目里真 id 是 `p_<项目>~schedule`。一律用
// `isSheet(activeSheetId, …)` 比较(见 sheet-short-name.ts:二三级展开就是栽在这)。
const SCHEDULE_SHEET_ID = 'schedule';
const ORDER_SHEET_ID = 'orders';

// Grid theme tuned to Veylin's identity: the app's system font + its shadcn CSS
// variables (so the grid tracks light/dark automatically), tighter density, a
// clean borderless look (hairline row separators, no vertical gridlines, no heavy
// header fill), and the app's neutral accent for selection/focus.
const veylinGridTheme = themeQuartz.withParams({
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  fontSize: 13,
  spacing: 6,
  rowHeight: 34,
  headerHeight: 38,
  backgroundColor: 'var(--background)',
  foregroundColor: 'var(--foreground)',
  borderColor: 'var(--border)',
  chromeBackgroundColor: 'var(--muted)',
  headerBackgroundColor: 'var(--background)',
  headerTextColor: 'var(--muted-foreground)',
  headerFontWeight: 600,
  headerFontSize: 12,
  oddRowBackgroundColor: 'transparent',
  rowHoverColor: 'var(--muted)',
  selectedRowBackgroundColor: 'var(--accent)',
  accentColor: 'var(--ring)',
  wrapperBorderRadius: 8,
  wrapperBorder: false,
  columnBorder: false,
});

// Columns worth showing in the B2 preview dialog (filtered by presence in the payload)
const PREVIEW_COLUMNS: Array<{ key: string; labelKey: string }> = [
  { key: 'order_id', labelKey: 'table.previewColOrder' },
  { key: 'workshop', labelKey: 'table.previewColWorkshop' },
  { key: 'schedule_status', labelKey: 'table.previewColStatus' },
  { key: 'planned_end', labelKey: 'table.previewColPlannedEnd' },
  { key: 'due_at', labelKey: 'table.previewColDueAt' },
];

// honest_status → i18n key for the preview dialog's summary line; falls back
// to the raw value for statuses we don't have a translation for.
const PREVIEW_STATUS_KEYS: Record<string, string> = {
  feasible: 'table.previewStatusFeasible',
  infeasible: 'table.previewStatusInfeasible',
  not_scheduled: 'table.previewStatusNotScheduled',
};

function honestStatusLabel(t: (key: string) => string, raw: unknown): string {
  const key = PREVIEW_STATUS_KEYS[String(raw ?? '')];
  return key ? t(key) : String(raw ?? '-');
}

// Schedule-row lateness for the row accent stripe: compares a row's planned `end`
// against its `due_at` (both ISO dates the schedule sheet carries). 'late' = past
// due; 'atrisk' = lands within the buffer (7d) of due. No-op for rows/sheets that
// don't carry both fields (returns null → no stripe).
const _ATRISK_BUFFER_MS = 7 * 24 * 60 * 60 * 1000;
function scheduleLateness(row: Record<string, unknown> | undefined): 'late' | 'atrisk' | null {
  const end = row?.['end'];
  const due = row?.['due_at'];
  if (!end || !due) return null;
  const e = Date.parse(String(end));
  const d = Date.parse(String(due));
  if (!Number.isFinite(e) || !Number.isFinite(d)) return null;
  if (e > d) return 'late';
  if (d - e < _ATRISK_BUFFER_MS) return 'atrisk';
  return null;
}

interface ScheduleDetail {
  rows: Record<string, unknown>[];
  // status-column tone map (from the 三级 response's own columns), so the detail
  // badges are metadata-driven exactly like the main grid — nothing hardcoded.
  semantics?: Record<string, string>;
}

async function fetchScheduleDetail(
  orderId: unknown,
  stageCode: unknown,
  threadId: string | undefined,
): Promise<ScheduleDetail> {
  const qs = new URLSearchParams();
  if (orderId != null && orderId !== '') qs.set('order_id', String(orderId));
  if (stageCode != null && stageCode !== '') qs.set('stage_code', String(stageCode));
  if (threadId) qs.set('threadId', threadId);
  try {
    const res = await fetch(`/api/schedule-detail?${qs.toString()}`);
    if (!res.ok) return { rows: [] };
    const data = (await res.json()) as {
      rows?: Record<string, unknown>[];
      columns?: Array<{ key?: string; type?: string; semantics?: Record<string, string> }>;
    };
    const statusCol = data.columns?.find((c) => c.type === 'status' && c.semantics);
    return {
      rows: Array.isArray(data.rows) ? data.rows : [],
      semantics: statusCol?.semantics,
    };
  } catch {
    return { rows: [] };
  }
}

interface TableColumnDef {
  key: string;
  name: string;
  width: number;
  type: TableColumnType;
  frozen?: boolean;
  deletable: boolean;
  statusOptions?: string[];
  // {status value -> generic tone} from the data source; drives badge colour.
  semantics?: Record<string, string>;
}

interface TableSheet {
  id: string;
  name: string;
  builtin: boolean;
}

interface TableGridTotals {
  rowCount: number;
  selectedCount: number;
  loadedCount?: number;
  expectedCount?: number | null;
}

type FilterState = { query: string };

const STATUS_GREEN = 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300';
const STATUS_AMBER = 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300';
const STATUS_RED = 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300';
const STATUS_SLATE = 'bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300';
const STATUS_BLUE = 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300';

// GENERIC tone → colour. The tone vocabulary is universal; which status VALUE is
// which tone is DOMAIN knowledge the data source ships as column `semantics`
// metadata (Compass: solved→positive, 已完工→positive…), never hardcoded here — so
// this one grid renders scheduling, inventory, QA… each in its own colours. A value
// with no declared tone is NEUTRAL (honest: no invented colour).
type StatusTone = 'positive' | 'warning' | 'negative' | 'neutral' | 'info';
const TONE_STYLE: Record<StatusTone, string> = {
  positive: STATUS_GREEN,
  warning: STATUS_AMBER,
  negative: STATUS_RED,
  neutral: STATUS_SLATE,
  info: STATUS_BLUE,
};

// Fallback tones for Veylin's OWN built-in, domain-agnostic status vocabulary —
// used only when the data source ships no `semantics` (a user-added status column,
// an Excel import, or a sheet persisted before semantics existed). These are
// universal words, NOT a domain's (solved/已完工… deliberately live in metadata, not
// here). Data-source semantics always override this.
const FALLBACK_TONE: Record<string, StatusTone> = {
  open: 'neutral',
  in_progress: 'warning',
  done: 'positive',
  normal: 'positive',
  tight: 'warning',
  overdue: 'negative',
};

function statusClass(value: string, semantics?: Record<string, string>): string {
  const tone = (semantics?.[value] as StatusTone | undefined) ?? FALLBACK_TONE[value] ?? 'neutral';
  return TONE_STYLE[tone] ?? TONE_STYLE.neutral;
}

function humanizeStatus(value: string): string {
  return value.replace(/_/g, ' ');
}

function resolveStatusOptions(def: TableColumnDef, rows: TableRow[]): string[] {
  const seen = new Set<string>();
  for (const opt of def.statusOptions?.length ? def.statusOptions : DEFAULT_TABLE_STATUS_OPTIONS) {
    seen.add(opt);
  }
  for (const row of rows) {
    const v = String(row[def.key] ?? '').trim();
    if (v) seen.add(v);
  }
  return [...seen];
}

const EMPTY_FILTERS: FilterState = { query: '' };
const HISTORY_LIMIT = 20;

type ScheduleEdit = {
  rowKey: string;
  columnKey: string;
  before: string | number;
  after: string | number;
};

type HistoryBatch = ScheduleEdit[];

type SchedulePayload = {
  sheet?: string;
  sheets?: TableSheet[];
  columns?: TableColumnDef[];
  rows?: TableRow[];
  totalRows?: number;
};

const DEFAULT_EMPTY_COLUMNS: TableColumnDef[] = [];
const DEFAULT_EMPTY_SHEETS: TableSheet[] = [
  { id: 'main', name: 'Sheet 1', builtin: true },
];

function emptySchedulePayload(sheetId: string): SchedulePayload {
  return {
    sheet: sheetId,
    sheets: DEFAULT_EMPTY_SHEETS,
    columns: DEFAULT_EMPTY_COLUMNS,
    rows: [],
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function readJsonResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(i18n.t('table.noResponse', { status: res.status }));
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(i18n.t('table.invalidResponse', { status: res.status }));
  }
}

/**
 * 取一张表。**必须带 threadId** —— 服务端要靠它推出这一屏的作用域(项目 or
 * 个人区)。不带就等于每次都问"个人区有什么",项目的表一张也看不到。
 * `sheetId` 省略 = 让服务端给这个作用域的默认表(切项目时用)。
 */
async function fetchSchedule(
  sheetId: string | undefined,
  threadId?: string,
  page?: { offset: number; limit: number },
): Promise<SchedulePayload> {
  const qs = new URLSearchParams();
  if (sheetId) qs.set('sheet', sheetId);
  if (threadId) qs.set('threadId', threadId);
  if (page) {
    qs.set('offset', String(page.offset));
    qs.set('limit', String(page.limit));
  }
  const res = await fetch(`/api/table?${qs.toString()}`);
  const data = await readJsonResponse<SchedulePayload>(res);
  if (!res.ok) {
    throw new Error((data as { message?: string }).message ?? `HTTP ${res.status}`);
  }
  return data;
}

/**
 * 提交改动过的行。**一次一个批次**,打到 `PATCH /api/table/rows`。
 *
 * 这里曾经是 `PATCH /api/table` 打单行 —— 而服务端只有 `/api/table/rows`,于是
 * 普通单元格编辑一直是 404:本地看着改了,实际一个字也没存进去(上游 2026-07
 * 的 batch-PATCH 修复没进我们这条 fork)。
 *
 * `threadId` 决定服务端解析到哪个作用域;不带就是个人区,项目里的表会 404。
 */
/** 读成 base64(留档用;解析仍在前端做)。 */
async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  const CHUNK = 0x8000;               // 大文件别一次性 apply,会爆栈
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

async function patchRows(
  sheetId: string,
  rows: TableRow[],
  threadId?: string,
): Promise<boolean> {
  if (rows.length === 0) return true;
  try {
    const res = await fetch('/api/table/rows', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sheet: sheetId,
        threadId,
        rows: rows.map((row) => ({ row_key: rowKey(row), ...row })),
      }),
    });
    const data = (await res.json()) as { ok?: boolean };
    return res.ok && data.ok === true;
  } catch {
    return false;
  }
}


function applyHistoryBatch(
  allRows: TableRow[],
  batch: HistoryBatch,
  mode: 'undo' | 'redo',
): TableRow[] {
  const valueKey = mode === 'undo' ? 'before' : 'after';
  return allRows.map((row) => {
    const key = rowKey(row);
    const edits = batch.filter((e) => e.rowKey === key);
    if (edits.length === 0) return row;
    let updated = { ...row };
    for (const edit of edits) {
      updated = { ...updated, [edit.columnKey]: edit[valueKey] };
    }
    return updated;
  });
}

// applyFilters: used for React-level pre-filter before passing rowData to AG-Grid
function applyFilters(rows: TableRow[], filters: FilterState): TableRow[] {
  const q = filters.query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) =>
    Object.values(row).some((v) => String(v ?? '').toLowerCase().includes(q)),
  );
}

function compareScheduleValues(
  a: string | number | undefined,
  b: string | number | undefined,
  type: TableColumnType,
): number {
  const aEmpty = a === undefined || a === '';
  const bEmpty = b === undefined || b === '';
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return -1;
  if (bEmpty) return 1;
  if (type === 'number') return Number(a) - Number(b);
  return String(a).localeCompare(String(b), 'zh-CN', { numeric: true });
}

function cellTextValue(row: TableRow, columnKey: string): string {
  const value = row[columnKey];
  if (value === undefined || value === null) return '';
  return String(value);
}

function TableGridFooter({ totals }: { totals: TableGridTotals }) {
  const { t } = useTranslation();
  return (
    <div
      className="border-border bg-muted/40 text-muted-foreground flex shrink-0 items-center gap-x-4 gap-y-1 border-t px-3 py-1.5 text-xs"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="text-foreground font-medium">
        {totals.expectedCount != null &&
        totals.loadedCount != null &&
        totals.loadedCount < totals.expectedCount
          ? t('table.footerLoading', {
              loaded: totals.loadedCount,
              total: totals.expectedCount,
            })
          : t('table.footerTotal', { count: totals.rowCount })}
      </span>
      {totals.selectedCount > 0 ? (
        <span>{t('table.footerSelected', { count: totals.selectedCount })}</span>
      ) : null}
    </div>
  );
}

function StatusBadge({
  status,
  semantics,
}: {
  status: string;
  semantics?: Record<string, string>;
}) {
  const { t } = useTranslation();
  if (!status) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        statusClass(status, semantics),
      )}
    >
      {t(`table.status.${status}`, { defaultValue: humanizeStatus(status) })}
    </span>
  );
}

// Custom master-detail panel: the order's 三级 工艺路线 as a clean styled list
// (not a raw nested AG-Grid). AG-Grid passes the master row as params.data; we
// fetch the ops on expand. Read-only. Pairs with detailRowAutoHeight so it hugs
// its content. Replaces the default bordered detail grid.
function ScheduleDetailPanel(params: { data?: Record<string, unknown> }) {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [semantics, setSemantics] = useState<Record<string, string> | undefined>(undefined);
  // Same remoteId-first pattern as mcp-app-tool.tsx: pin this read-only lookup
  // to the currently open thread so a grouped Compass deployment resolves
  // unambiguously instead of refusing (see the panel-level threadId note on
  // TableGrid below).
  const localThreadId = useAuiState((s) => s.threadListItem.id);
  const remoteThreadId = useAuiState((s) => s.threadListItem.remoteId ?? s.threadListItem.externalId);
  const threadId = remoteThreadId ?? localThreadId ?? undefined;
  useEffect(() => {
    let alive = true;
    void fetchScheduleDetail(params.data?.['order_id'], params.data?.['stage_code'], threadId).then((d) => {
      if (alive) {
        setRows(d.rows);
        setSemantics(d.semantics);
      }
    });
    return () => {
      alive = false;
    };
  }, [params.data, threadId]);
  const day = (v: unknown) => (typeof v === 'string' && v.length >= 10 ? v.slice(0, 10) : '');

  return (
    <div className="border-l-2 border-primary/25 bg-muted/25 py-1.5 pl-9 pr-3">
      {rows === null ? (
        <div className="py-1.5 text-xs text-muted-foreground">加载三级工艺路线…</div>
      ) : rows.length === 0 ? (
        <div className="py-1.5 text-xs text-muted-foreground">该订单暂无三级工艺明细</div>
      ) : (
        <div className="flex flex-col">
          {rows.map((op, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded px-2 py-1 text-xs hover:bg-muted/60"
            >
              <span className="w-8 shrink-0 tabular-nums text-muted-foreground">
                {String(op['op_seq'] ?? '')}
              </span>
              <span className="min-w-[7rem] shrink-0 font-medium">{String(op['op_name'] ?? '-')}</span>
              <span className="min-w-[6rem] shrink-0 text-muted-foreground">
                {String(op['resource_id'] ?? '')}
              </span>
              <StatusBadge status={String(op['status'] ?? '')} semantics={semantics} />
              <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                {day(op['planned_start'])}
                {day(op['planned_end']) ? ` → ${day(op['planned_end'])}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// AG-Grid v36 custom header: name click → column selection, chevron → native sort
interface AgColumnHeaderParams extends IHeaderParams<TableRow> {
  columnKey: string;
  onSelect: (key: string | null) => void;
  selectedKeyRef: { current: string | null };
}

function AgColumnHeader(params: AgColumnHeaderParams) {
  const { t } = useTranslation();
  const [sort, setSort] = useState<string | null | undefined>(
    () => params.column.getSort(),
  );

  useEffect(() => {
    const handler = () => setSort(params.column.getSort());
    params.column.addEventListener('sortChanged', handler);
    return () => params.column.removeEventListener('sortChanged', handler);
  }, [params.column]);

  const isSelected = params.selectedKeyRef.current === params.columnKey;

  return (
    <div className="flex size-full min-h-9 items-center justify-center gap-0.5 px-1">
      <button
        type="button"
        className={cn(
          'min-w-0 flex-1 truncate px-2 py-1 text-center text-xs outline-none',
          isSelected ? 'text-primary font-medium' : 'hover:bg-muted/60',
        )}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          params.onSelect(isSelected ? null : params.columnKey);
        }}
      >
        {params.displayName}
      </button>
      <button
        type="button"
        tabIndex={-1}
        aria-label={t('table.sortBy', { name: params.displayName })}
        className="text-muted-foreground hover:text-foreground shrink-0 rounded p-0.5"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          params.progressSort(e.shiftKey);
        }}
      >
        {sort === 'asc' ? (
          <ChevronUp className="size-3.5" />
        ) : sort === 'desc' ? (
          <ChevronDown className="size-3.5" />
        ) : (
          <ChevronUp className="size-3.5 opacity-25" />
        )}
      </button>
    </div>
  );
}

export function TableGrid() {
  const { t } = useTranslation();
  // Same remoteId-first pattern as mcp-app-tool.tsx / composer-activated-skills.tsx:
  // the local composer id until the thread's first message assigns a server
  // remoteId/externalId. The grid panel is workspace-wide (no per-session props —
  // see the "Fork seam" comment in routes/tables.ts), but the Compass-backed
  // load/edit calls below still send this so a grouped Compass deployment
  // resolves via the CURRENTLY OPEN thread's project pin instead of refusing
  // under ambiguity.
  const localThreadId = useAuiState((s) => s.threadListItem.id);
  const remoteThreadId = useAuiState((s) => s.threadListItem.remoteId ?? s.threadListItem.externalId);
  const threadId = remoteThreadId ?? localThreadId ?? undefined;
  const aui = useAui();
  // 排产即导航: a cockpit drill (focusScheduleFilter) stashes an OpenGridFilter
  // here; we position the already-loaded grid via an AG-Grid external filter.
  const { scheduleFilter, clearScheduleFilter, tabs: panelTabs } = usePanelTabs();
  // keep-alive 的表格实例活得比「甘特页签刚开」更久。AG-Grid 可能还握着
  // 第一次 gridReady 时的 onCellClicked;从 ref 读当下页签,否则分屏后点作业号
  // 仍以为甘特没开,定位被静默丢掉。
  const panelTabsRef = useRef(panelTabs);
  panelTabsRef.current = panelTabs;
  // 表格↔甘特双向定位, table→gantt half: pulling the right sidebar open is
  // the CALLER's job (same split as mcp-app-tool.tsx's openWidget call site —
  // usePanelTabsState can't reach useRightSidebar, see its focusGanttJob doc).
  const { setOpen: setRightOpen } = useRightSidebar();
  const [sheets, setSheets] = useState<TableSheet[]>([]);
  const [activeSheetId, setActiveSheetId] = useState('main');
  const [columnDefs, setColumnDefs] = useState<TableColumnDef[]>([]);
  const [rows, setRows] = useState<TableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [compassLoading, setCompassLoading] = useState(false);
  const projects = useProjectsOrNull();
  const threadProjects = useThreadProjectsOrNull();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  // Rows actually shown after AG-Grid's column filters (the search box pre-filters
  // rowData; column filters narrow further inside the grid). null until first render.
  const [displayedCount, setDisplayedCount] = useState<number | null>(null);
  const [columnFilterActive, setColumnFilterActive] = useState(false);
  const [selectedRows, setSelectedRows] = useState<ReadonlySet<string>>(() => new Set());
  const [undoStack, setUndoStack] = useState<HistoryBatch[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryBatch[]>([]);
  const [selectedColumnKey, setSelectedColumnKey] = useState<string | null>(null);

  const lastSerialized = useRef('');
  const fillGenRef = useRef(0);
  const sheetTotalRowsRef = useRef<number | null>(null);
  const [sheetTotalRows, setSheetTotalRows] = useState<number | null>(null);
  const loadRef = useRef<(sheetId: string | undefined, initial: boolean) => Promise<void>>(
    async () => {},
  );
  const editingUntil = useRef(0);
  const isApplyingHistory = useRef(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  // AG-Grid API ref — populated in onGridReady
  const gridApiRef = useRef<GridApi<TableRow> | null>(null);
  /** 甘特点条定位选中行时,别再走表格→甘特把页签切回去。 */
  const suppressGanttLocateRef = useRef(false);
  /** 点击穿透 / API 勾选会晚一拍,单靠 microtask 挡不住。 */
  const suppressGanttLocateUntilRef = useRef(0);
  /** 上一批列:用来认出这次多了哪一列(applyPayload 依赖为空,只能用 ref)。 */
  const columnDefsRef = useRef<TableColumnDef[]>([]);
  // Ref mirror of selectedColumnKey — read by AgColumnHeader on refreshHeader()
  const selectedColumnKeyRef = useRef<string | null>(null);
  // Ref mirror of rows — used in async paste handler to avoid stale closure
  const rowsRef = useRef<TableRow[]>(rows);
  // load() 是 useCallback 且不该因为换会话就重建(SSE 订阅挂在它上面),
  // 所以当前 threadId 走 ref 读。
  const threadIdRef = useRef<string | undefined>(threadId);
  // 迟到的响应要能认出自己是哪张表的 —— applyPayload 的依赖是空数组,
  // 只能靠 ref 读到此刻在看的是哪张表。
  const activeSheetIdRef = useRef<string>('main');
  /**
   * **有意换表**要同步更新 ref,不能只 setState。
   *
   * 守卫(shouldApplyPayload)看的是 activeSheetIdRef;而 React 的 state 更新是
   * 异步的 —— 作用域切换那条路是"先 setActiveSheetId(新表)、紧接着 applyPayload",
   * 那一刻 ref 还指着旧表,于是守卫把**这份正确的数据**当成迟到响应丢掉了:
   * 改钉到别的项目之后,面板还摆着上一个项目的表(实测)。
   * 两个修复互相绊脚,记在这儿。
   */
  /** 用户自己点过表没有 —— 点过之后,异步回来的自动切换就不该再抢。 */
  const userPickedSheetRef = useRef(false);
  const selectSheet = useCallback((id: string) => {
    activeSheetIdRef.current = id;
    setActiveSheetId(id);
  }, []);
  const sseErrorNotified = useRef(false);
  // Agent-requested chart waiting for the target sheet's rows to be on screen
  const pendingChartRef = useRef<{
    sheet: string;
    columns: string[];
    chartType: string;
    aggFunc?: string;
  } | null>(null);
  // A drill filter waiting for the grid to be live with rows (same apply-when-
  // ready idiom as pendingChartRef). activeGridFilterRef holds the filter AG-Grid
  // is currently positioned to — read by isExternalFilterPresent/doesExternalFilterPass
  // (props, so they must read a ref, not state — cf. selectedColumnKeyRef).
  const pendingScheduleFilterRef = useRef<OpenGridFilter | null>(null);
  const activeGridFilterRef = useRef<OpenGridFilter | null>(null);
  // 切焦段时带过去的锚点(见 switchSheet)。新焦段的行到齐后定位过去。
  const pendingAnchorRef = useRef<LocateTarget | null>(null);
  // 「怎么看的」也跟着走:分组 + 列筛选。新焦段没有那列就带不过去 —— 而带不过去
  // 要说出来(见 lib/grain-view-carry.ts)。
  const pendingViewRef = useRef<{ filterModel: Record<string, unknown>; groupBy: string[] } | null>(null);
  // 判断一次点击落在网格里还是网格外(见 askBubbleAction)
  const gridWrapRef = useRef<HTMLDivElement | null>(null);
  const askBubbleRef = useRef<HTMLDivElement | null>(null);

  const drawPendingChart = useCallback((attempt = 0) => {
    const pending = pendingChartRef.current;
    if (!pending) return;
    // Re-read the api every attempt: switching to the target sheet REMOUNTS the
    // grid (schedule↔other changes the master-detail key), so the api captured
    // when the request arrived is destroyed — the fresh grid's onGridReady
    // repopulates gridApiRef. Retry until a live grid with rows is present.
    const api = gridApiRef.current;
    const ready =
      api &&
      typeof api.createRangeChart === 'function' &&
      !api.isDestroyed?.() &&
      (api.getDisplayedRowCount?.() ?? 0) > 0;
    if (!ready) {
      if (attempt < 20) setTimeout(() => drawPendingChart(attempt + 1), 150);
      return;
    }
    pendingChartRef.current = null;
    try {
      api.createRangeChart({
        cellRange: { columns: pending.columns },
        chartType: pending.chartType as 'groupedColumn',
        ...(pending.aggFunc ? { aggFunc: pending.aggFunc } : {}),
      });
    } catch {
      /* Enterprise/charts unavailable — ignore */
    }
  }, []);

  // Position the grid to a pending drill filter once it's live with rows. Same
  // remount-safe retry as drawPendingChart: re-read gridApiRef each attempt.
  // "late" is a computed predicate (scheduleLateness), not a column value, so we
  // drive an AG-Grid EXTERNAL filter — set activeGridFilterRef, then onFilterChanged().
  const applyPendingScheduleFilter = useCallback((attempt = 0) => {
    const pending = pendingScheduleFilterRef.current;
    if (!pending) return;
    const api = gridApiRef.current;
    const ready =
      api && !api.isDestroyed?.() && (api.getDisplayedRowCount?.() ?? 0) > 0;
    if (!ready) {
      if (attempt < 20) setTimeout(() => applyPendingScheduleFilter(attempt + 1), 150);
      return;
    }
    pendingScheduleFilterRef.current = null;
    activeGridFilterRef.current = pending;
    api.onFilterChanged();
  }, []);

  /**
 * 三档,不是两档。
 *
 * 「当前项目没有绑定文件夹,原件没有留档」是一句**陈述**,不是错误 —— 从前它用
 * 报错的红底白字弹出来,吓人(用户原话),而且把"你需要知道的事"和"出事了"
 * 混成了同一种语气。中性档专门给这类:要说,但不该像出了故障。
 */
const showToast = useCallback((message: string, variant: 'success' | 'error' | 'note') => {
    setToast({ message, variant });
  }, []);

  // 到达新焦段后,把分组与筛选按新焦段有的列重新装上;装不上的报出来。
  const applyPendingView = useCallback((attempt = 0) => {
    const pending = pendingViewRef.current;
    if (!pending) return;
    const api = gridApiRef.current;
    const ready = api && !api.isDestroyed?.() && (api.getDisplayedRowCount?.() ?? 0) > 0;
    if (!ready) {
      if (attempt < 20) setTimeout(() => applyPendingView(attempt + 1), 150);
      return;
    }
    pendingViewRef.current = null;
    const available = new Set(
      (api.getColumns?.() ?? []).map((c) => c.getColId?.()).filter(Boolean) as string[],
    );
    const carried = carryViewAcrossGrain(
      {
        groupBy: pending.groupBy,
        filters: Object.fromEntries(Object.keys(pending.filterModel).map((k) => [k, '1'])),
      },
      available,
    );
    try {
      api.setRowGroupColumns?.(carried.groupBy);
      const keep = Object.fromEntries(
        Object.entries(pending.filterModel).filter(([k]) => k in carried.filters),
      );
      api.setFilterModel?.(Object.keys(keep).length ? keep : null);
    } catch {
      /* Enterprise 分组不可用时忽略 —— 筛选照常 */
    }
    if (carried.dropped.length) {
      showToast(
        t('table.viewCarryDropped', { cols: carried.dropped.map((d) => d.key).join('、') }),
        'error',
      );
    }
  }, [showToast, t]);

  // 到达新焦段后定位到锚点那一单。同样的 remount-safe 重试(切 sheet 会重建网格)。
  const locatePendingAnchor = useCallback((attempt = 0) => {
    const target = pendingAnchorRef.current;
    if (!target) return;
    const api = gridApiRef.current;
    const ready = api && !api.isDestroyed?.() && (api.getDisplayedRowCount?.() ?? 0) > 0;
    if (!ready) {
      if (attempt < 40) setTimeout(() => locatePendingAnchor(attempt + 1), 150);
      return;
    }
    const nodes: IRowNode<TableRow>[] = [];
    api.forEachNodeAfterFilterAndSort((node) => {
      if (node.data) nodes.push(node);
    });
    const picked = pickLocateRows(
      nodes.map((n) => n.data as Record<string, unknown>),
      target,
      { hasMore: shouldWaitForMoreRows(rowsRef.current.length, sheetTotalRowsRef.current) },
    );
    if (picked.status === 'wait') {
      if (attempt < 80) setTimeout(() => locatePendingAnchor(attempt + 1), 200);
      return;
    }
    const hitSet = new Set(picked.rows);
    const hits = nodes.filter((n) => n.data && hitSet.has(n.data as Record<string, unknown>));
    if (picked.status === 'miss' || hits.length === 0) {
      pendingAnchorRef.current = null;
      // 这一单在这个焦段没有行 —— 说出来。三级只覆盖二级的一部分,静悄悄地
      // 停在别处等于让人以为自己找错了。
      showToast(t('table.anchorNotHere', { anchor: target.jobId ?? target.orderId ?? '' }), 'error');
      return;
    }
    pendingAnchorRef.current = null;
    // **分页要先翻到那一页,不然 ensureNodeVisible 是白喊**(真机实测挖出来的,
    // 甘特→表格定位那条评审要求 F4 才第一次真正走到这条路径——之前唯一在用的
    // 调用方多半巧合地落在第一页,从没暴露过)。这张表恒定开着 AG-Grid 分页
    // (`pagination` + `paginationPageSize={500}`,见下方 <AgGridReact>):
    // `ensureNodeVisible` 只管"在当前页里滚到看得见",目标行在别的页时它什么
    // 都不做——不报错、不提示,表现就是"点了没反应"。行到哪页由它在排序过滤
    // 后的序号决定,先翻页,`ensureNodeVisible` 才有意义。
    const pageSize = api.paginationGetPageSize?.() ?? 0;
    const rowIndex = hits[0]!.rowIndex;
    if (pageSize > 0 && rowIndex != null) {
      api.paginationGoToPage?.(Math.floor(rowIndex / pageSize));
    }
    api.ensureNodeVisible(hits[0]!, 'middle');
    api.flashCells({ rowNodes: hits });
    // 点选单元格不会选中行(enableClickSelection: false),只闪一下看不出
    // 是哪一行。用 API 勾上这一行;挡掉随后落到作业号上的 locateGantt,
    // 否则甘特页签还开着会 open('gantt') 把人踢回去。
    suppressGanttLocateRef.current = true;
    suppressGanttLocateUntilRef.current = Date.now() + 400;
    hits[0]!.setSelected(true, true);
    const data = hits[0]!.data;
    if (data) setSelectedRows(new Set([rowKey(data)]));
    window.setTimeout(() => {
      if (Date.now() >= suppressGanttLocateUntilRef.current) {
        suppressGanttLocateRef.current = false;
      }
    }, 400);
  }, [t]);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    activeSheetIdRef.current = activeSheetId;
  }, [activeSheetId]);

  useEffect(() => {
    threadIdRef.current = threadId;
  }, [threadId]);

  const [importing, setImporting] = useState(false);
  const [snapshotting, setSnapshotting] = useState(false);
  // 项目文件夹里冒出来的新文件(spec §6:只提示,不自动吸收)
  const [inboxPending, setInboxPending] = useState<Array<{ name: string }>>([]);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const [importConfirmOpen, setImportConfirmOpen] = useState(false);
  const [addColumnOpen, setAddColumnOpen] = useState(false);
  const [newColumnName, setNewColumnName] = useState('');
  const [addingColumn, setAddingColumn] = useState(false);
  const [toast, setToast] = useState<{ message: string; variant: 'success' | 'error' | 'note' } | null>(
    null,
  );
  const [deleteSheetTarget, setDeleteSheetTarget] = useState<TableSheet | null>(null);
  const [deletingSheet, setDeletingSheet] = useState(false);
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [newSheetName, setNewSheetName] = useState('');
  const [addingSheet, setAddingSheet] = useState(false);

  // B2 governed schedule draft (Compass-side; count is grid-known ops)
  const [draftOps, setDraftOps] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewData, setPreviewData] = useState<{
    rows: Array<Record<string, unknown>>;
    diagnosis: Record<string, unknown>;
  } | null>(null);
  const [committing, setCommitting] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const resetImportInput = useCallback(() => {
    if (importInputRef.current) importInputRef.current.value = '';
  }, []);

  const editableKeys = useMemo(() => new Set(columnDefs.map((c) => c.key)), [columnDefs]);

  // Column selection — syncs React state + ref, then refreshes AG-Grid headers
  const selectColumn = useCallback((key: string | null) => {
    setSelectedColumnKey(key);
    selectedColumnKeyRef.current = key;
    if (key) {
      setSelectedRows(new Set());
      gridApiRef.current?.deselectAll();
    }
    gridApiRef.current?.refreshHeader();
  }, []);

  const clearColumnSelection = useCallback(() => {
    setSelectedColumnKey(null);
    selectedColumnKeyRef.current = null;
    gridApiRef.current?.refreshHeader();
  }, []);

  const resetSheetUiState = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    gridApiRef.current?.setFilterModel(null);   // drop the previous sheet's column filters
    // Drop any positioned drill filter too, so it never leaks across sheets.
    pendingScheduleFilterRef.current = null;
    activeGridFilterRef.current = null;
    gridApiRef.current?.onFilterChanged();
    setSelectedRows(new Set());
    setUndoStack([]);
    setRedoStack([]);
    setSelectedColumnKey(null);
    selectedColumnKeyRef.current = null;
    lastSerialized.current = '';
    fillGenRef.current += 1;
    sheetTotalRowsRef.current = null;
    setSheetTotalRows(null);
    setDraftOps(0);
    setPreviewOpen(false);
    setPreviewData(null);
  }, []);

  /**
   * **新加的列要自己滚到眼前。**
   *
   * agent 加完列,面板只是把列表换掉 —— 新列常在横向滚动之外,人根本看不见,
   * 于是以为"没加上"(用户实测:算完均价说加了备注,他在屏幕上找不到)。
   * 首屏不滚:那时每一列都是"新"的,滚过去只会把视线甩到最右边。
   */
  const revealNewColumn = useCallback((next: TableColumnDef[]) => {
    const target = columnToReveal(
      columnDefsRef.current.map((c) => c.key),
      next.map((c) => c.key),
    );
    columnDefsRef.current = next;
    if (!target) return;
    // 等这一批列真的上了屏再滚 —— setColumnDefs 之后 AG-Grid 还没认识这一列。
    setTimeout(() => {
      const api = gridApiRef.current;
      if (!api) return;
      try {
        api.ensureColumnVisible(target);
        api.flashCells({ columns: [target] });
      } catch {
        /* 列还没就绪就算了 —— 这是锦上添花,不该为它报错 */
      }
    }, 120);
  }, []);

  const applyPayload = useCallback((data: SchedulePayload, initial: boolean) => {
    // 有人请求"导完切到这张表"(预览里的导入)—— 页签一到齐就切过去,只生效一次。
    const wanted = data.sheets ? consumeSheetSelection() : null;
    if (wanted) {
      const target = data.sheets?.find((s) => s.name === wanted);
      if (target) {
        activeSheetIdRef.current = target.id;
        setActiveSheetId(target.id);
      }
    }
    // **迟到的响应不许盖住当前这张表。** 切表会重建 SSE,旧连接的 onopen 会用
    // 过期闭包再拉一次上一张表;不挡的话,你点了开发组件、屏幕上却是 Sheet 1 的
    // 空表 —— 用户看到的就是「点不动」(实测日志:08:12:49 点开发组件,
    // 08:12:50 被 sheet_1 的响应盖了回去)。
    if (!shouldApplyPayload(data.sheet, activeSheetIdRef.current)) return;
    // 空数组也要照收:换到一个还没装过表的项目时,页签就该空掉,而不是留着
    // 上一个作用域的页签(那正是"个人区看得见项目的表"那个病的另一半)。
    if (data.sheets) setSheets(data.sheets);
    // **首屏要认领解析后的表 id。** 面板初值是未解析的 `main`,服务端把它解析成
    // 这个作用域里的真表并回了数据;不认领的话 activeSheetId 一直是 `main`,
    // 于是**没有任何页签是高亮的**——"当前表"不存在,后面的切换全都不对劲
    // (用户实测:点了 orders 之后别的表就切不动了)。
    if (data.sheet && activeSheetIdRef.current === 'main') {
      activeSheetIdRef.current = data.sheet;
      setActiveSheetId(data.sheet);
    }
    if (data.columns) {
      setColumnDefs(data.columns);
      revealNewColumn(data.columns);
    }
    const next = data.rows ?? [];
    setLoading(false);
    if (Date.now() < editingUntil.current) return;
    const serialized = JSON.stringify(next);
    if (serialized === lastSerialized.current) return;
    lastSerialized.current = serialized;
    setRows(next);
  }, [revealNewColumn]);

  const startFill = useCallback(async (sheetId: string, start: number, total: number, gen: number) => {
    let offset = start;
    while (offset < total) {
      if (fillGenRef.current !== gen) return;
      if (Date.now() < editingUntil.current) {
        const wait = Math.max(50, editingUntil.current - Date.now() + 50);
        window.setTimeout(() => {
          if (fillGenRef.current === gen) {
            void startFill(sheetId, rowsRef.current.length, total, gen);
          }
        }, wait);
        return;
      }
      const page = await fetchSchedule(sheetId, threadIdRef.current, {
        offset,
        limit: TABLE_GRID_FILL_CHUNK,
      });
      if (fillGenRef.current !== gen) return;
      if (!shouldApplyPayload(page.sheet, activeSheetIdRef.current)) return;
      const incoming = page.rows ?? [];
      if (incoming.length === 0) break;
      setRows((prev) => prev.concat(incoming));
      offset += incoming.length;
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 0);
      });
    }
  }, []);

  const acceptPage = useCallback(
    (data: SchedulePayload, initial: boolean, gen: number) => {
      if (fillGenRef.current !== gen) return;
      const got = data.rows ?? [];
      const total = data.totalRows ?? got.length;
      const nextSig = JSON.stringify(got);
      const keepExisting =
        Date.now() < editingUntil.current || nextSig === lastSerialized.current;
      applyPayload(data, initial);
      sheetTotalRowsRef.current = total;
      setSheetTotalRows(total);
      const sheetKey = data.sheet ?? activeSheetIdRef.current;
      const fillFrom = tableFillOffset(
        keepExisting ? rowsRef.current.length : got.length,
        total,
      );
      if (fillFrom != null && sheetKey) {
        void startFill(sheetKey, fillFrom, total, gen);
      }
    },
    [applyPayload, startFill],
  );

  const load = useCallback(
    async (sheetId: string | undefined, initial: boolean) => {
      const gen = ++fillGenRef.current;
      const firstPage = { offset: 0, limit: TABLE_GRID_FIRST_PAGE };
      const attempts = initial ? 6 : 1;
      for (let i = 0; i < attempts; i++) {
        try {
          const data = await fetchSchedule(sheetId, threadIdRef.current, firstPage);
          if (fillGenRef.current !== gen) return;
          acceptPage(data, initial, gen);
          if (initial) setLoadError(null);
          return;
        } catch (err) {
          // **记着的那张表不在这个作用域里 —— 退回默认表,不报红。**
          // 面板会记住"上次在看哪张表",而那个 id 常常属于上一个项目;换过来
          // 之后服务端认不出,直接 404。人什么也没做错,不该看见一条红条
          // (实测:重启 dev 仍在报「表格数据加载失败:sheet not found」)。
          const message = err instanceof Error ? err.message : '';
          if (isStaleSheetError(message) && sheetId) {
            try {
              const fallback = await fetchSchedule(undefined, threadIdRef.current, firstPage);
              if (fillGenRef.current !== gen) return;
              if (fallback.sheet) selectSheet(fallback.sheet);
              acceptPage(fallback, true, gen);
              setLoadError(null);
              return;
            } catch {
              /* 默认表也取不到 —— 那是真故障,落到下面照常报 */
            }
          }
          if (i < attempts - 1) {
            await sleep(400 * (i + 1));
            continue;
          }
          if (initial) {
            setLoadError(message || t('table.loadFailedGeneric'));
            showToast(t('table.loadError', { error: message || t('table.loadFailedGeneric') }), 'error');
            sheetTotalRowsRef.current = 0;
            setSheetTotalRows(0);
            applyPayload(emptySchedulePayload(sheetId ?? 'main'), true);
          }
        }
      }
    },
    [acceptPage, applyPayload, showToast, t, selectSheet],
  );
  loadRef.current = load;

  const switchSheet = useCallback(
    (sheetId: string) => {
      if (sheetId === activeSheetId) return;
      // 焦段之间带上锚点:切表前记下"我在看哪一单",到了新焦段再定位过去。
      // 用户对多表切换的担心就是这个 —— 每切一次都得重新找位置。
      const api = gridApiRef.current;
      const focused = api?.getFocusedCell?.();
      const focusedRow =
        focused != null ? api?.getDisplayedRowAtIndex?.(focused.rowIndex)?.data : undefined;
      let anchor = anchorOfRow(focusedRow as Record<string, unknown> | undefined);
      if (!anchor) {
        const selected = api?.getSelectedRows?.()?.[0];
        anchor = anchorOfRow(selected as Record<string, unknown> | undefined);
      }
      // **这一整段只是"记住我在看哪儿",不能把切表本身搞崩。**
      // AG-Grid v36 里 getRowGroupColumns 会返回 undefined(行分组模块没注册),
      // `?.()` 挡得住方法不存在、挡不住返回 undefined —— 紧跟的 .forEach 抛出
      // TypeError,整个点击处理器当场死掉:表现就是"点了页签毫无反应"
      // (用户实测:点进 orders 之后别的表都切不动了)。
      const groupBy: string[] = [];
      try {
        (api?.getRowGroupColumns?.() ?? []).forEach((c) => {
          const id = c.getColId?.();
          if (id) groupBy.push(id);
        });
      } catch {
        /* 记不住分组就算了 —— 锦上添花,不该挡住切表 */
      }
      let filterModel: Record<string, unknown> = {};
      try {
        filterModel = (api?.getFilterModel?.() ?? {}) as Record<string, unknown>;
      } catch {
        /* 同上 */
      }
      resetSheetUiState();
      pendingViewRef.current =
        groupBy.length || Object.keys(filterModel).length ? { filterModel, groupBy } : null;
      pendingAnchorRef.current = anchor ? { orderId: anchor } : null;
      userPickedSheetRef.current = true;
      selectSheet(sheetId);
      setLoading(true);
    },
    [activeSheetId, resetSheetUiState, selectSheet],
  );

  const confirmDeleteSheet = async () => {
    if (!deleteSheetTarget || deletingSheet) return;
    setDeletingSheet(true);
    try {
      const res = await fetch(
        `/api/table/sheets/${encodeURIComponent(deleteSheetTarget.id)}`,
        { method: 'DELETE' },
      );
      const data = await readJsonResponse<{
        ok?: boolean;
        message?: string;
        sheets?: TableSheet[];
        nextSheet?: string;
      }>(res);
      if (!res.ok || !data.ok) {
        showToast(data.message ?? t('table.deleteSheetFailed'), 'error');
        return;
      }
      if (data.sheets) setSheets(data.sheets);
      if (deleteSheetTarget.id === activeSheetId && data.nextSheet) {
        resetSheetUiState();
        setActiveSheetId(data.nextSheet);
        setLoading(true);
      }
      setDeleteSheetTarget(null);
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : t('table.deleteSheetFailed'), 'error');
    } finally {
      setDeletingSheet(false);
    }
  };

  const suggestNewSheetName = useCallback(() => {
    const used = new Set(sheets.map((s) => s.name));
    let n = sheets.length + 1;
    while (used.has(`Sheet ${n}`)) n++;
    return `Sheet ${n}`;
  }, [sheets]);

  const openAddSheetDialog = useCallback(() => {
    setNewSheetName(suggestNewSheetName());
    setAddSheetOpen(true);
  }, [suggestNewSheetName]);

  const submitAddSheet = async () => {
    const name = newSheetName.trim();
    if (!name) return;
    setAddingSheet(true);
    try {
      const res = await fetch('/api/table/sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await readJsonResponse<{
        ok?: boolean;
        message?: string;
        sheet?: TableSheet;
        sheets?: TableSheet[];
      }>(res);
      if (!res.ok || !data.ok || !data.sheet) {
        showToast(data.message ?? t('table.createSheetFailed'), 'error');
        return;
      }
      if (data.sheets) setSheets(data.sheets);
      resetSheetUiState();
      setActiveSheetId(data.sheet.id);
      setLoading(true);
      setAddSheetOpen(false);
      setNewSheetName('');
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : t('table.createSheetFailed'), 'error');
    } finally {
      setAddingSheet(false);
    }
  };

  // Bootstrap-on-mount only (deps below deliberately omit threadId): the grid
  // panel is workspace-wide, not remounted per thread (see the "Fork seam"
  // comment in routes/tables.ts), so this fires once. `threadId` is still read
  // from the closure so whichever thread is open when the panel first loads
  // resolves Compass through that thread's project pin.
  useEffect(() => {
    // **先知道这个项目有没有接 Compass,再决定说什么。** 从前无条件拉,于是在
    // 和 Compass 无关的项目里先闪一句"正在从 Compass 加载",再弹一个"未加载"
    // 的错误 —— 一个根本不成立的故事。
    const decision = decideCompassLoad({
      threadId,
      projects,
      threadProjects,
    });
    if (decision === 'wait') return;
    if (decision === 'skip') {
      setBootstrapped(true);
      return;
    }
    // 本地已经有表就先画第一页,别让 Compass 整表重导堵住首屏。
    setBootstrapped(true);
    let cancelled = false;
    void (async () => {
      setCompassLoading(true);
      try {
        const res = await fetch('/api/table/load-compass-schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ threadId }),
        });
        const data = await readJsonResponse<{
          ok?: boolean;
          sheet?: string;
          error?: string;
          imported?: number;
        }>(res);
        if (cancelled) return;
        if (data.ok && data.sheet) {
          // **用户已经点过别的表就别抢。** Compass 是面板挂载后异步拉的,
          // 拉回来再切一次当前表 —— 人在这中间点了小表,会被硬拽回「工序」
          // (实测:大表小表来回切时,刚点完就被弹回去)。
          if (!userPickedSheetRef.current) {
            selectSheet(data.sheet);
          }
          const watching =
            !userPickedSheetRef.current || data.sheet === activeSheetIdRef.current;
          if (watching) {
            lastSerialized.current = '';
            void loadRef.current(data.sheet, false);
          }
        } else if (!data.ok) {
          showToast(data.error ?? t('table.compassUnavailable'), 'error');
        }
      } catch {
        if (!cancelled) {
          showToast(t('table.compassUnavailable'), 'error');
        }
      } finally {
        if (!cancelled) {
          setCompassLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showToast, t, threadId, projects, threadProjects]);

  // Live sync: SSE 推行级增量。整表只在首屏 / 导入替换时分页拉,不一次灌 3 万行。
  useEffect(() => {
    if (!bootstrapped) return;
    void load(activeSheetId, true);
    // 带上 threadId:服务端据此推出作用域,只推这个作用域里的表的变更(spec §7)。
    // 换会话可能换作用域,所以 threadId 进依赖 —— 连接跟着重建。
    const es = new EventSource(
      `/api/table/stream${threadId ? `?threadId=${encodeURIComponent(threadId)}` : ''}`);
    es.onopen = () => {
      sseErrorNotified.current = false;
      // 续灌还没完就再 load 会把第一页重画一遍。已经在灌的那次会把后面接上。
      if (shouldWaitForMoreRows(rowsRef.current.length, sheetTotalRowsRef.current)) return;
      void load(activeSheetId, false);
    };
    es.onmessage = (ev) => {
      let e: TableEvent;
      try {
        e = JSON.parse(ev.data) as TableEvent;
      } catch {
        return;
      }
      if (e.type === 'sheetsChange') {
        void load(activeSheetId, false);
        return;
      }
      if (e.type === 'chart') {
        // Not sheet-scoped: the chart request carries its own target sheet and
        // switches to it (drawing once that sheet's rows are on screen). Must be
        // handled BEFORE the active-sheet filter below, or a chart aimed at an
        // inactive sheet is silently dropped.
        pendingChartRef.current = e;
        if (e.sheet === activeSheetId) drawPendingChart();
        else setActiveSheetId(e.sheet);
        return;
      }
      if (e.sheet !== activeSheetId) return; // sheet-scoped events for the active sheet only
      if (e.type === 'rowUpsert') {
        const incoming = e.row;
        const key = rowKey(incoming);
        setRows((prev) => {
          const idx = prev.findIndex((r) => rowKey(r) === key);
          if (idx === -1) return [...prev, incoming];
          const next = prev.slice();
          next[idx] = incoming;
          return next;
        });
      } else if (e.type === 'rowsDelete') {
        const drop = new Set(e.keys);
        setRows((prev) => prev.filter((r) => !drop.has(rowKey(r))));
      } else if (e.type === 'sheetReplace' || e.type === 'schemaChange') {
        lastSerialized.current = '';
        void load(activeSheetId, false);
      }
    };
    es.onerror = () => {
      if (sseErrorNotified.current) return;
      sseErrorNotified.current = true;
      showToast(t('table.sseDisconnected'), 'error');
    };
    return () => es.close();
  }, [activeSheetId, load, bootstrapped, showToast, t, threadId]);

  // 换会话 = 可能换了作用域(项目 ⇄ 个人区)。表是**那个作用域的 context**,
  // 所以整屏跟着走:重取该作用域的页签,并落到它的默认表。不这么做的话,个人区
  // 里会继续摆着上一个项目的三万行 —— 而 agent 那侧早就读不到了,两边说法打架。
  // 身份是**(对话, 项目)这一对**,不是对话本身:同一条对话可以被改钉到别的项目
  // (侧栏的移动菜单、输入框上的项目选择器)。只认 threadId 的话,那时屏幕上还是
  // 上一个项目的表 —— 而这轮对话已经归给了新项目,在面板里的编辑也会落到旧表上。
  const currentPin = threadId ? threadProjects?.[threadId] : undefined;
  const scopeKey = panelScopeKey(threadId, currentPin);
  const lastScopeThread = useRef<string>(scopeKey);
  useEffect(() => {
    if (!bootstrapped) return;
    if (lastScopeThread.current === scopeKey) return;
    lastScopeThread.current = scopeKey;
    let cancelled = false;
    void (async () => {
      try {
        const data = await fetchSchedule(undefined, threadId, {
          offset: 0,
          limit: TABLE_GRID_FIRST_PAGE,
        });
        if (cancelled) return;
        resetSheetUiState();
        const gen = fillGenRef.current;
        setSheets(data.sheets ?? []);
        // **用户选过表就别抢。** 作用域重取会落到"默认表",而项目钉定是异步落定的
        // —— 它一落定这个 effect 就跑,把人刚点的表换掉:表现就是"点了切不过去"
        // (用户实测:点 orders 之后停在原来那张)。换作用域本身要重选,所以
        // 换的时候把这个标记清掉。
        // 换作用域本来就该重选:清掉"用户选过"的标记,再落到新作用域的默认表。
        userPickedSheetRef.current = false;
        if (data.sheet) selectSheet(data.sheet);
        lastSerialized.current = '';
        acceptPage(data, true, gen);
      } catch (err) {
        // **不能静默维持现状。** 这一屏已经属于新作用域了,取不到就意味着屏幕上
        // 摆着的是**上一个项目的表** —— 人在这儿的编辑会落到旧项目。实测这次取数
        // 偶发会失败(改钉之后紧接着请求),从前被这句空 catch 吞掉,表现成"面板
        // 没跟过来",查不出原因。重试一次,还不行就说出来。
        if (cancelled) return;
        try {
          const retry = await fetchSchedule(undefined, threadId, {
            offset: 0,
            limit: TABLE_GRID_FIRST_PAGE,
          });
          if (cancelled) return;
          resetSheetUiState();
          const gen = fillGenRef.current;
          setSheets(retry.sheets ?? []);
          if (retry.sheet) selectSheet(retry.sheet);
          lastSerialized.current = '';
          acceptPage(retry, true, gen);
        } catch {
          // 下一次 SSE / 手动切换还会再试,但这一刻必须让人知道屏幕不可信。
          lastScopeThread.current = '';
          showToast(t('table.loadError', { error: err instanceof Error ? err.message : String(err) }), 'error');
        }
      }
    })();
    return () => {
      cancelled = true;
      fillGenRef.current += 1;
    };
  }, [threadId, scopeKey, bootstrapped, acceptPage, resetSheetUiState, selectSheet, showToast, t]);

  // 进到一个项目(或换了会话)时看一眼文件夹里有没有没见过的文件。**只看不吸收**:
  // 顺手放一份 ≠ 它就是项目数据(spec §6)。
  useEffect(() => {
    if (!bootstrapped) return;
    let cancelled = false;
    void (async () => {
      try {
        const qs = threadId ? `?threadId=${encodeURIComponent(threadId)}` : '';
        const res = await fetch(`/api/table/inbox${qs}`);
        const data = (await res.json()) as { ok?: boolean; pending?: Array<{ name: string }> };
        if (!cancelled && data.ok) setInboxPending(data.pending ?? []);
      } catch {
        /* 扫不到就算了 —— 这只是个提示,不该打断任何事 */
      }
    })();
    return () => { cancelled = true; };
  }, [threadId, bootstrapped]);

  // A pending agent chart draws once its target sheet's rows have loaded.
  useEffect(() => {
    if (pendingChartRef.current?.sheet === activeSheetId && rows.length > 0) {
      drawPendingChart();
    }
  }, [rows, activeSheetId, drawPendingChart]);

  // A cockpit drill arrives via the panel store → position the grid. "late"
  // activates the external filter (the sole status compass emits); an
  // `order_id` drill (甘特点条→表格定位,spec §4) positions to that one order
  // via the grain-anchor mechanism instead — same split as the two panel-store
  // paths (focusScheduleFilter vs the anchor set by sheet switches). Anything
  // else just leaves the grid open, unpositioned. Never throws.
  // `scheduleFilter.at` makes repeat drills of the same filter re-fire.
  useEffect(() => {
    if (!scheduleFilter) return;
    if (isLateOnlyGridFilter(scheduleFilter.filter)) {
      pendingScheduleFilterRef.current = scheduleFilter.filter;
      // Position on the schedule sheet: other sheets (e.g. orders) lack the
      // end/due_at fields scheduleLateness reads, so a late filter there would
      // blank the grid. Mirror the pending-chart path's raw setActiveSheetId —
      // switching remounts + reloads, and the apply-when-ready retry / rows
      // fallback then applies the filter. If the schedule sheet isn't
      // bootstrapped yet, the bootstrap load makes it active and the same
      // fallback fires (no throw when the id isn't present yet).
      if (isSheet(activeSheetId, SCHEDULE_SHEET_ID)) {
        applyPendingScheduleFilter();
      } else {
        // 真 id,不是短名:项目里这张表叫 `p_<项目>~schedule`,切到短名等于切到一张
        // 不存在的表(见 sheet-short-name.ts)。
        setActiveSheetId(findSheetIdByShortName(sheets, SCHEDULE_SHEET_ID) ?? SCHEDULE_SHEET_ID);
      }
    } else if (scheduleFilter.filter.order_id || scheduleFilter.filter.job_id) {
      // 甘特点条→表格定位:作业号优先,对不上再退回订单号。找不到怎么办
      // 仍走 locatePendingAnchor(续灌等待 / 诚实 toast / 滚动闪烁)。
      suppressGanttLocateRef.current = true;
      suppressGanttLocateUntilRef.current = Date.now() + 400;
      window.setTimeout(() => {
        if (Date.now() >= suppressGanttLocateUntilRef.current) {
          suppressGanttLocateRef.current = false;
        }
      }, 400);
      pendingAnchorRef.current = {
        jobId: scheduleFilter.filter.job_id,
        orderId: scheduleFilter.filter.order_id,
      };
      if (isSheet(activeSheetId, SCHEDULE_SHEET_ID)) {
        locatePendingAnchor();
      } else {
        setActiveSheetId(findSheetIdByShortName(sheets, SCHEDULE_SHEET_ID) ?? SCHEDULE_SHEET_ID);
      }
    }
    clearScheduleFilter();
  }, [
    scheduleFilter,
    activeSheetId,
    sheets,
    applyPendingScheduleFilter,
    locatePendingAnchor,
    clearScheduleFilter,
  ]);

  // Fallback for a drill that landed before rows finished loading (mirrors the
  // pending-chart rows effect): apply once rows are on screen.
  useEffect(() => {
    if (pendingScheduleFilterRef.current && rows.length > 0) {
      applyPendingScheduleFilter();
    }
  }, [rows, applyPendingScheduleFilter]);

  // 换了焦段、新一批行到齐 → 先恢复视图(分组/筛选),再定位到切换前那一单。
  useEffect(() => {
    if (rows.length === 0) return;
    if (pendingViewRef.current) applyPendingView();
    if (pendingAnchorRef.current) locatePendingAnchor();
  }, [rows, locatePendingAnchor, applyPendingView]);

  // Pre-filter rows in React; AG-Grid handles sort natively via comparator
  const filteredRows = useMemo(() => applyFilters(rows, filters), [rows, filters]);

  const totals = useMemo<TableGridTotals>(
    () => ({
      rowCount: displayedCount ?? filteredRows.length,
      selectedCount: selectedRows.size,
      loadedCount: rows.length,
      expectedCount: sheetTotalRows,
    }),
    [displayedCount, filteredRows.length, selectedRows.size, rows.length, sheetTotalRows],
  );

  const commitRows = useCallback(
    (merged: TableRow[], touchedKeys: ReadonlySet<string>) => {
      lastSerialized.current = JSON.stringify(merged);
      editingUntil.current = Date.now() + 3000;
      setRows(merged);
      void patchRows(activeSheetId, merged.filter((r) => touchedKeys.has(rowKey(r))), threadId);
    },
    [activeSheetId, threadId],
  );

  // B2: send one governed cell edit into the Compass draft
  const proposeGovernedEdit = useCallback(
    async (row: Record<string, unknown>, columnKey: string, value: string | number) => {
      const body = buildGovernedEditBody(row, columnKey, value);
      if (!body) return;
      try {
        const res = await fetch('/api/schedule-edit/propose', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, threadId }),
        });
        const data = await readJsonResponse<{ ok?: boolean; ops?: number; refused?: string; error?: string }>(res);
        if (!res.ok || !data.ok) {
          showToast(
            data.refused
              ? t('table.draftRefused', { message: data.refused })
              : (data.error ?? t('table.draftProposeFailed')),
            'error',
          );
          editingUntil.current = 0;
          void load(activeSheetId, false);
          return;
        }
        setDraftOps(data.ops ?? 0);
      } catch (e: unknown) {
        showToast(e instanceof Error ? e.message : t('table.draftProposeFailed'), 'error');
      }
    },
    [activeSheetId, load, showToast, t, threadId],
  );

  const openPreview = useCallback(async () => {
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewData(null);
    try {
      const res = await fetch('/api/schedule-edit/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId }),
      });
      const data = await readJsonResponse<{
        ok?: boolean;
        rows?: Array<Record<string, unknown>>;
        diagnosis?: Record<string, unknown>;
        error?: string;
      }>(res);
      if (!res.ok || !data.ok) {
        showToast(data.error ?? t('table.draftProposeFailed'), 'error');
        setPreviewOpen(false);
        return;
      }
      setPreviewData({ rows: data.rows ?? [], diagnosis: data.diagnosis ?? {} });
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : t('table.draftProposeFailed'), 'error');
      setPreviewOpen(false);
    } finally {
      setPreviewLoading(false);
    }
  }, [showToast, t, threadId]);

  const commitDraft = useCallback(async () => {
    if (committing) return;
    setCommitting(true);
    try {
      const res = await fetch('/api/schedule-edit/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId }),
      });
      const data = await readJsonResponse<{
        ok?: boolean;
        committed?: number;
        deferred?: number;
        conflict?: boolean;
        message?: string;
        error?: string;
        recorded?: boolean;
        recordPath?: string;
        recordNote?: string;
      }>(res);
      if (!res.ok || !data.ok) {
        showToast(
          data.conflict ? t('table.commitConflict') : (data.message ?? data.error ?? t('table.draftProposeFailed')),
          'error',
        );
        return;
      }
      showToast(
        t('table.commitDone', { committed: data.committed ?? 0, deferred: data.deferred ?? 0 }),
        'success',
      );
      // 这次提交的依据自动留档了(spec §5.1 第三档)。留成了说落在哪儿,没留成说
      // 为什么 —— 两种都得说,不能让人以为翻得了账而其实翻不了。
      if (data.recorded && data.recordPath) {
        setTimeout(() => showToast(t('table.decisionRecorded'), 'success'), 1200);
      } else if (data.recordNote) {
        setTimeout(() => showToast(data.recordNote!, 'error'), 1200);
      }
      setDraftOps(0);
      setPreviewOpen(false);
      editingUntil.current = 0;
      void load(activeSheetId, false);
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : t('table.draftProposeFailed'), 'error');
    } finally {
      setCommitting(false);
    }
  }, [activeSheetId, committing, load, showToast, t, threadId]);

  const discardDraft = useCallback(async () => {
    try {
      const res = await fetch('/api/schedule-edit/discard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId }),
      });
      const data = await readJsonResponse<{ ok?: boolean; error?: string }>(res);
      if (!res.ok || !data.ok) {
        showToast(data.error ?? t('table.draftProposeFailed'), 'error');
        return;
      }
      showToast(t('table.discardDone'), 'success');
      setDraftOps(0);
      setPreviewOpen(false);
      editingUntil.current = 0;
      void load(activeSheetId, false);
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : t('table.draftProposeFailed'), 'error');
    }
  }, [activeSheetId, load, showToast, t, threadId]);

  const pushHistory = useCallback((batch: HistoryBatch) => {
    if (batch.length === 0) return;
    setUndoStack((prev) => {
      const next = [...prev, batch];
      if (next.length > HISTORY_LIMIT) next.shift();
      return next;
    });
    setRedoStack([]);
  }, []);

  const applyHistory = useCallback(
    (batch: HistoryBatch, mode: 'undo' | 'redo') => {
      isApplyingHistory.current = true;
      setRows((current) => {
        const merged = applyHistoryBatch(current, batch, mode);
        lastSerialized.current = JSON.stringify(merged);
        editingUntil.current = Date.now() + 3000;
        const touched = new Set(batch.map((e) => e.rowKey));
        void patchRows(activeSheetId, merged.filter((r) => touched.has(rowKey(r))), threadId);
        return merged;
      });
      queueMicrotask(() => {
        isApplyingHistory.current = false;
      });
    },
    [activeSheetId],
  );

  const handleUndo = useCallback(() => {
    setUndoStack((undo) => {
      const batch = undo.at(-1);
      if (!batch) return undo;
      setRedoStack((redo) => [...redo, batch]);
      applyHistory(batch, 'undo');
      return undo.slice(0, -1);
    });
  }, [applyHistory]);

  const handleRedo = useCallback(() => {
    setRedoStack((redo) => {
      const batch = redo.at(-1);
      if (!batch) return redo;
      setUndoStack((undo) => {
        const next = [...undo, batch];
        if (next.length > HISTORY_LIMIT) next.shift();
        return next;
      });
      applyHistory(batch, 'redo');
      return redo.slice(0, -1);
    });
  }, [applyHistory]);

  // AG-Grid cell value changed → push undo entry + call commitRows (server writeback)
  const onCellValueChanged = useCallback(
    (event: CellValueChangedEvent<TableRow>) => {
      if (isApplyingHistory.current) return;
      const columnKey = event.colDef.field ?? '';
      if (!columnKey || !editableKeys.has(columnKey)) return;

      const oldValue = event.oldValue ?? '';
      const newValue = event.newValue ?? '';
      if (String(oldValue) === String(newValue)) return;

      const edit: ScheduleEdit = {
        rowKey: rowKey(event.data),
        columnKey,
        before: oldValue as string | number,
        after: newValue as string | number,
      };
      pushHistory([edit]);

      // event.data is already mutated with the new value by AG-Grid
      const updatedRow = event.data;
      const merged = rowsRef.current.map((r) =>
        rowKey(r) === rowKey(updatedRow) ? updatedRow : r,
      );
      commitRows(merged, new Set([rowKey(updatedRow)]));

      // B2: on the schedule sheet, governed edits also go into the Compass draft
      if (isSheet(activeSheetId, SCHEDULE_SHEET_ID)) {
        void proposeGovernedEdit(
          updatedRow as unknown as Record<string, unknown>,
          columnKey,
          newValue as string | number,
        );
      }
    },
    [activeSheetId, commitRows, editableKeys, proposeGovernedEdit, pushHistory],
  );

  // AG-Grid keyboard handler: undo/redo + Community-safe copy/paste
  const onGridCellKeyDown = useCallback(
    (event: CellKeyDownEvent<TableRow>) => {
      const ke = event.event as KeyboardEvent | undefined;
      if (!ke) return;
      const ctrl = ke.ctrlKey || ke.metaKey;
      if (!ctrl) return;
      const key = ke.key.toLowerCase();

      if (key === 'z' && !ke.shiftKey) {
        ke.preventDefault();
        handleUndo();
        return;
      }
      if ((key === 'z' && ke.shiftKey) || key === 'y') {
        ke.preventDefault();
        handleRedo();
        return;
      }
      // Copy: write raw cell value to clipboard (bypasses AG-Grid's formatted copy)
      if (key === 'c') {
        const colId = event.column.getColId();
        if (colId && colId !== '__rowNum__' && event.data) {
          void navigator.clipboard.writeText(cellTextValue(event.data, colId));
          ke.preventDefault();
        }
        return;
      }
      // Paste: read clipboard, coerce to column type, commit via patchRows
      if (key === 'v') {
        const colId = event.column.getColId();
        if (colId && editableKeys.has(colId) && event.data) {
          ke.preventDefault();
          const rowSnap = event.data;
          void navigator.clipboard.readText().then((text) => {
            const trimmed = text.trim();
            const currentRows = rowsRef.current;
            const def = columnDefs.find((c) => c.key === colId);
            let newValue: string | number = trimmed;
            if (def?.type === 'number') {
              const n = Number(trimmed);
              if (!Number.isFinite(n)) return;
              newValue = n;
            } else if (def?.type === 'status') {
              const opts = resolveStatusOptions(def, currentRows);
              if (!opts.includes(trimmed)) return;
            }
            if (newValue === (rowSnap[colId] ?? '')) return;
            const updatedRow = { ...rowSnap, [colId]: newValue };
            const merged = currentRows.map((r) =>
              rowKey(r) === rowKey(updatedRow) ? updatedRow : r,
            );
            const edit: ScheduleEdit = {
              rowKey: rowKey(rowSnap),
              columnKey: colId,
              before: (rowSnap[colId] ?? '') as string | number,
              after: newValue,
            };
            pushHistory([edit]);
            commitRows(merged, new Set([rowKey(updatedRow)]));
          });
        }
      }
    },
    [columnDefs, commitRows, editableKeys, handleRedo, handleUndo, pushHistory],
  );

  const tryLocateGanttFromRow = useCallback(
    (row: TableRow | undefined) => {
      if (!row) return;
      if (suppressGanttLocateRef.current || Date.now() < suppressGanttLocateUntilRef.current) {
        return;
      }
      // **甘特页签必须已经开着才联动。** 没开就什么都不做,不抢面板。
      const ganttTabOpen = panelTabsRef.current.some((tab) => tab.kind === 'gantt');
      if (
        !ganttTabOpen ||
        !isSheet(activeSheetIdRef.current, SCHEDULE_SHEET_ID) ||
        !hasGantt()
      ) {
        return;
      }
      const jobId = row['job_id'];
      const orderId = row['order_id'];
      if (jobId == null || jobId === '') return;
      setRightOpen(true);
      const fromDate = scheduleLocateFromDate(row);
      locateGantt({
        jobId: String(jobId),
        ...(orderId != null && orderId !== '' ? { orderId: String(orderId) } : {}),
        ...(fromDate ? { fromDate } : {}),
      });
    },
    [setRightOpen],
  );

  // AG-Grid selection changed → sync React selectedRows (used by toolbar + totals)
  const onSelectionChanged = useCallback(
    (event: SelectionChangedEvent<TableRow>) => {
      const nodes = event.api.getSelectedNodes().filter((n) => n.data != null);
      const selected = nodes.map((n) => rowKey(n.data!));
      setSelectedRows(new Set(selected));
      if (selected.length > 0) clearColumnSelection();
    },
    [clearColumnSelection],
  );

  // 只有作业号是「去甘特看这一道」。勾选、点其它列都留在表里。
  const onCellClicked = useCallback(
    (event: CellClickedEvent<TableRow>) => {
      const colId = event.column?.getColId?.() ?? '';
      if (!shouldLocateGanttFromTableClick(colId)) return;
      tryLocateGanttFromRow(event.data);
    },
    [tryLocateGanttFromRow],
  );

  const onGridReady = useCallback((event: GridReadyEvent<TableRow>) => {
    gridApiRef.current = event.api;
  }, []);

  // Keep the footer count honest under column filters. onModelUpdated fires on
  // rowData (search) AND column-filter/sort/group changes → single source of truth.
  const onModelUpdated = useCallback(() => {
    const api = gridApiRef.current;
    if (!api) return;
    // Count filtered LEAF data rows only — getDisplayedRowCount() also counts group
    // header + master-detail rows, which would inflate the footer on the grouped /
    // schedule / orders sheets.
    let c = 0;
    api.forEachNodeAfterFilterAndSort((n) => {
      if (n.data != null && !n.group) c += 1;
    });
    setDisplayedCount((prev) => (prev === c ? prev : c));
    const active = api.isAnyFilterPresent?.() ?? false;
    setColumnFilterActive((prev) => (prev === active ? prev : active));
  }, []);

  // Clear BOTH the global search and every AG-Grid column filter (incl. the
  // positioned drill's external filter, which isAnyFilterPresent() counts).
  const clearAllFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    pendingScheduleFilterRef.current = null;
    activeGridFilterRef.current = null;
    gridApiRef.current?.setFilterModel(null);
    gridApiRef.current?.onFilterChanged();
  }, []);

  // Status options per column — includes values already present in rows
  const statusOptionsByKey = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const def of columnDefs) {
      if (def.type === 'status') map.set(def.key, resolveStatusOptions(def, rows));
    }
    return map;
  }, [columnDefs, rows]);

  // Per-number-column max, for a whisper-alpha magnitude tint (data-bar feel).
  // Only columns with a positive spread get a max → flat/index-like columns stay
  // untinted (less is more: a cue where magnitude means something, nowhere else).
  const numberColMax = useMemo(() => {
    const m = new Map<string, number>();
    for (const def of columnDefs) {
      if (def.type !== 'number') continue;
      let max = 0;
      let min = Infinity;
      let seen = false;
      for (const r of rows) {
        const v = Number(r[def.key]);
        if (Number.isFinite(v)) { max = Math.max(max, v); min = Math.min(min, v); seen = true; }
      }
      if (seen && max > 0 && max !== min) m.set(def.key, max);
    }
    return m;
  }, [columnDefs, rows]);

  // AG-Grid column definitions: row-number + typed data columns
  // 二三级 master-detail (Pro): only on the schedule sheet, only when entitled AND
  // Enterprise modules are loaded (setting masterDetail props otherwise → module error).
  const proEnterprise = hasProEntitlement() && isAgGridEnterpriseReady();
  // Master-detail on the schedule sheet (per-工序 → that stage's ops) AND the orders
  // sheet (per-订单 → full 三级 route: order rows carry order_id but no stage_code,
  // so the same detail fetch returns the whole route unfiltered).
  const proMasterDetail =
    (isSheet(activeSheetId, SCHEDULE_SHEET_ID) || isSheet(activeSheetId, ORDER_SHEET_ID))
    && proEnterprise;

  // Generic Enterprise affordances for EVERY sheet (no sheet-specific logic —
  // Veylin stays a generic host): drag-to-group row grouping, columns/filters
  // side panels, cell range selection, "Chart Range" from the context menu, and
  // a selection-aggregation status bar. Only when Enterprise is licensed+loaded.
  const proGridProps = useMemo(() => {
    if (!proEnterprise) return {};
    return {
      rowGroupPanelShow: 'always' as const,
      cellSelection: true,
      enableCharts: true,
      // allow any data column to be dragged into the group panel / aggregated
      defaultColDef: { enableRowGroup: true, enableValue: true, enablePivot: true },
      sideBar: {
        toolPanels: ['columns', 'filters'],
        hiddenByDefault: false,
        defaultToolPanel: '',
      },
      statusBar: {
        statusPanels: [
          { statusPanel: 'agSelectedRowCountComponent', align: 'left' },
          { statusPanel: 'agAggregationComponent', align: 'right' },
        ],
      },
    };
  }, [proEnterprise]);

  const agColDefs = useMemo<ColDef<TableRow>[]>(() => {
    const defs: ColDef<TableRow>[] = [];

    // Pinned row-number column (read-only, no sort)
    defs.push({
      colId: '__rowNum__',
      headerName: '',
      width: 52,
      minWidth: 52,
      maxWidth: 52,
      pinned: 'left' as const,
      lockPosition: true,
      lockPinned: true,
      sortable: false,
      resizable: false,
      editable: false,
      cellClass: 'veylin-readonly',
      suppressNavigable: true,
      suppressMovable: true,
      enableRowGroup: false,
      enableValue: false,
      enablePivot: false,
      suppressHeaderFilterButton: true,
      valueGetter: (p) => (p.node?.rowIndex ?? 0) + 1,
      cellStyle: {
        textAlign: 'center',
        color: 'var(--muted-foreground)',
        fontSize: '0.75rem',
        fontVariantNumeric: 'tabular-nums',
      },
    });

    // Master-detail expander column (Pro) — the agGroupCellRenderer draws the
    // expand/collapse chevron that reveals each 二级 row's 三级 detail grid.
    if (proMasterDetail) {
      defs.push({
        colId: '__expand__',
        headerName: '',
        width: 44,
        minWidth: 44,
        maxWidth: 44,
        pinned: 'left' as const,
        lockPosition: true,
        lockPinned: true,
        sortable: false,
        resizable: false,
        editable: false,
        suppressMovable: true,
        enableRowGroup: false,
        enableValue: false,
        enablePivot: false,
        suppressHeaderFilterButton: true,
        suppressHeaderMenuButton: true,
        cellRenderer: 'agGroupCellRenderer',
      });
    }

    // 排产表:作业号是跳甘特的手势,紧跟订单号,不要垫在最后一列。
    const dataCols = isSheet(activeSheetId, SCHEDULE_SHEET_ID)
      ? placeJobIdAfterOrderId(columnDefs)
      : columnDefs;

    // Data columns
    for (const def of dataCols) {
      const isEditable =
        isSheet(activeSheetId, SCHEDULE_SHEET_ID) ? GOVERNED_EDIT_FIELDS.has(def.key) : true;
      const baseColDef: ColDef<TableRow> = {
        field: def.key,
        colId: def.key,
        headerName: def.name,
        width: def.width,
        resizable: true,
        sortable: true,
        pinned:
          def.frozen || (isSheet(activeSheetId, SCHEDULE_SHEET_ID) && def.key === 'job_id')
            ? ('left' as const)
            : undefined,
        editable: isEditable,
        suppressNavigable: !isEditable,
        // Hover cue on the schedule sheet's governed-edit cells (改资源/日期→propose).
        // 只读列不要焦点框:框在那儿人会以为能改(排产状态 solved 就是这样)。
        cellClass: [
          isSheet(activeSheetId, SCHEDULE_SHEET_ID) && isEditable ? 'veylin-editable' : '',
          isEditable ? '' : 'veylin-readonly',
        ]
          .filter(Boolean)
          .join(' ') || undefined,
        // Full value on hover — helps any truncated cell (IDs, long names).
        tooltipValueGetter: (p) => (p.value == null || p.value === '' ? null : String(p.value)),
        cellDataType: false,
        suppressHeaderFilterButton: true,
        // Per-column filtering. Text filter by default; number/status branches
        // override with the right filter type. A floating filter row under the
        // header makes it usable without depending on the custom header component,
        // and the Filters side panel auto-populates from these.
        filter: 'agTextColumnFilter',
        floatingFilter: true,
        valueFormatter: (params: ValueFormatterParams<TableRow>) => {
          const v = params.value;
          return v === undefined || v === null ? '' : String(v);
        },
        // zh-CN numeric comparator — reuses compareScheduleValues
        comparator: (valueA, valueB) =>
          compareScheduleValues(
            valueA as string | number | undefined,
            valueB as string | number | undefined,
            def.type,
          ),
        // Custom header: name click selects column, chevron cycles sort
        headerComponent: AgColumnHeader,
        headerComponentParams: {
          columnKey: def.key,
          onSelect: selectColumn,
          selectedKeyRef: selectedColumnKeyRef,
        },
      };

      if (def.type === 'number') {
        const heatMax = numberColMax.get(def.key);
        defs.push({
          ...baseColDef,
          type: 'rightAligned',   // right-align header + cells (numbers line up)
          filter: 'agNumberColumnFilter',   // =, ≠, <, >, range
          aggFunc: 'sum',   // group rows roll up numeric columns (只在分组时出现)
          cellEditor: 'agNumberCellEditor',
          cellStyle: (params: CellClassParams<TableRow>) => {
            const base = { textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const };
            // No tint on group/aggregated rows, or columns without meaningful spread.
            if (!heatMax || params.node?.group) return base;
            const v = Number(params.value);
            if (!Number.isFinite(v) || v <= 0) return base;
            const t = Math.min(1, v / heatMax);   // 0..1
            return { ...base, backgroundColor: `rgba(37, 99, 235, ${(0.05 + t * 0.22).toFixed(3)})` };
          },
        });
      } else if (def.type === 'sparkline' && proEnterprise) {
        // Cell holds a comma-separated numeric series ("3,5,2,…") → in-cell bar
        // trend via AG-Grid Sparklines. Read-only; falls to the text branch when
        // Enterprise isn't licensed/loaded.
        defs.push({
          ...baseColDef,
          editable: false,
          cellClass: 'veylin-readonly',
          suppressNavigable: true,
          sortable: false,
          filter: false,           // cell holds an array series → not filterable
          floatingFilter: false,
          valueGetter: (params) => {
            const raw = params.data?.[def.key];
            if (typeof raw !== 'string' || raw.trim() === '') return [];
            return raw.split(',').map((s) => Number(s.trim()) || 0);
          },
          cellRenderer: 'agSparklineCellRenderer',
          cellRendererParams: {
            sparklineOptions: { type: 'bar', direction: 'vertical' },
          },
        });
      } else if (def.type === 'status') {
        const options = statusOptionsByKey.get(def.key) ?? [];
        defs.push({
          ...baseColDef,
          // Multi-select checklist of the distinct statuses (Enterprise); falls back
          // to a text filter when Enterprise isn't licensed/loaded.
          filter: proEnterprise ? 'agSetColumnFilter' : 'agTextColumnFilter',
          cellEditor: 'agSelectCellEditor',
          cellEditorParams: { values: options },
          cellRenderer: (params: ICellRendererParams<TableRow>) => (
            <div className="flex size-full items-center justify-center px-2">
              <StatusBadge status={String(params.value ?? '')} semantics={def.semantics} />
            </div>
          ),
        });
      } else {
        // text
        defs.push({
          ...baseColDef,
          cellEditor: 'agTextCellEditor',
          cellStyle: { textAlign: 'center' },
        });
      }
    }

    // Schedule-sheet only: a hidden "排产月" column (derived YYYY-MM from `start`)
    // so pivot mode can build a time-axis load matrix (资源/分厂 × 月). Hidden by
    // default — no clutter in the normal view; drag it in from the columns panel.
    if (isSheet(activeSheetId, SCHEDULE_SHEET_ID) && columnDefs.some((d) => d.key === 'start')) {
      defs.push({
        colId: '__month__',
        headerName: '排产月',
        hide: true,
        enableRowGroup: true,
        enablePivot: true,
        valueGetter: (params) => {
          const s = params.data?.['start'];
          return typeof s === 'string' && s.length >= 7 ? s.slice(0, 7) : '';
        },
      });
    }

    return defs;
  }, [activeSheetId, columnDefs, statusOptionsByKey, numberColMax, selectColumn, proMasterDetail]);

  // AG-Grid v36 row selection config (object form)
  const rowSelection = useMemo(
    () => ({
      mode: 'multiRow' as const,
      checkboxes: true,
      headerCheckbox: true,
      // checkbox-only selection: clicking a cell (to edit) must NOT select the row.
      // shift-range still works natively via the checkboxes.
      enableClickSelection: false,
    }),
    [],
  );

  // (三级 detail is now the ScheduleDetailPanel custom renderer, which fetches on
  // expand — no detailGridOptions/getDetailRowData needed.)

  const handleAddRow = async () => {
    const res = await fetch('/api/table/rows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheet: activeSheetId, threadId }),
    });
    const data = (await res.json()) as { ok?: boolean; rows?: TableRow[] };
    if (data.ok && data.rows) {
      editingUntil.current = Date.now() + 3000;
      lastSerialized.current = JSON.stringify(data.rows);
      setRows(data.rows);
    }
  };

  const handleDeleteRows = async () => {
    if (selectedRows.size === 0) return;
    const res = await fetch('/api/table/rows', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheet: activeSheetId, row_keys: [...selectedRows], threadId }),
    });
    const data = (await res.json()) as { ok?: boolean; rows?: TableRow[] };
    if (!data.ok || !data.rows) return;
    resetSheetUiState();
    editingUntil.current = Date.now() + 3000;
    lastSerialized.current = JSON.stringify(data.rows);
    setRows(data.rows);
  };

  const openAddColumnDialog = useCallback(() => {
    setNewColumnName('');
    setAddColumnOpen(true);
  }, []);

  const submitAddColumn = async () => {
    const name = newColumnName.trim();
    if (!name) return;
    setAddingColumn(true);
    try {
      const res = await fetch('/api/table/columns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheet: activeSheetId, name, threadId }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        columns?: TableColumnDef[];
        rows?: TableRow[];
      };
      if (!data.ok) return;
      if (data.columns) {
        setColumnDefs(data.columns);
        revealNewColumn(data.columns);
      }
      if (data.rows) {
        editingUntil.current = Date.now() + 3000;
        lastSerialized.current = JSON.stringify(data.rows);
        setRows(data.rows);
      }
      setAddColumnOpen(false);
      setNewColumnName('');
    } finally {
      setAddingColumn(false);
    }
  };

  const handleDeleteColumn = async () => {
    if (!selectedColumnKey) return;
    const col = columnDefs.find((c) => c.key === selectedColumnKey);
    if (!col?.deletable) {
      showToast(t('table.columnNotDeletable'), 'error');
      return;
    }
    const res = await fetch('/api/table/columns', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheet: activeSheetId, key: selectedColumnKey, threadId }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      columns?: TableColumnDef[];
      rows?: TableRow[];
    };
    if (!data.ok) return;
    if (data.columns) setColumnDefs(data.columns);
    if (data.rows) {
      editingUntil.current = Date.now() + 3000;
      lastSerialized.current = JSON.stringify(data.rows);
      setRows(data.rows);
    }
    setSelectedColumnKey(null);
    selectedColumnKeyRef.current = null;
  };

  // 选区 → 对话引用。**登记引用,不塞数据**:agent 拿 id 去取当前值(见
  // lib/table-selection-ref.ts)。分组/筛选状态一起带走 —— 它是"这里为什么堆这么多"
  // 里的"这里"。
  // 拖选的单元格区域**不在** React state 里(它活在 AG-Grid 里),所以不能只看勾选行和
  // 选中列 —— 第一版就是这么错的:拖出一块区域时两个条件都不满足,按钮永远不冒。
  // 第二版错在反方向:点一个格子也算"区域"(1×1),于是勾了 4 行再点一下格子,引用就
  // 缩成了「1 行 · 列 order_id」。判定收进 resolveSelectionScope。
  const [rangeShape, setRangeShape] = useState<SelectionScope>(EMPTY_RANGE);
  const selectionScope = useMemo(
    () => resolveSelectionScope({
      range: rangeShape,
      checkedRowKeys: [...selectedRows],
      selectedColumnKey,
    }),
    [rangeShape, selectedRows, selectedColumnKey],
  );
  const canReference = selectionScope !== null;
  const referenceSelection = useCallback(async () => {
    if (!threadId || !activeSheetId || !selectionScope) return;
    const grouped: string[] = [];
    gridApiRef.current?.getRowGroupColumns?.().forEach((c) => {
      const id = c.getColId?.();
      if (id) grouped.push(id);
    });
    const res = await registerTableSelection({
      sheet: activeSheetId,
      threadId: String(threadId),
      rowKeys: selectionScope.rowKeys,
      columns: selectionScope.columns,
      groupBy: grouped,
      // 列筛选也是"这里"的一部分:同一批行,筛过和没筛过问的是两回事
      filter: Object.entries(filters)
        .filter(([, v]) => String(v ?? '').trim())
        .map(([k, v]) => `${k}=${String(v).trim()}`)
        .join(', '),
    });
    if (!res.ok) {
      showToast(res.message, 'error');
      return;
    }
    const composer = aui.composer();
    const next = appendSelectionToken(composer.getState().text, res.token);
    composer.setText(next);
    placeComposerCaret(next.length);
    setAskAnchor(null);
  }, [activeSheetId, aui, filters, selectionScope, showToast, threadId]);

  // 浮现式「问」:选完在手边冒出来,与已有的"选中文字→问"(thread-selection-ask)
  // 同一个手势。不再放工具栏 —— 一个动作只留一处入口。
  const [askAnchor, setAskAnchor] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    const onUp = (e: MouseEvent) => {
      const api = gridApiRef.current;
      if (!api) return;
      const target = e.target as Node | null;
      // 点在气泡自己身上:什么都别做(mouseup 早于 click,这时收掉就点不到了)
      if (target && askBubbleRef.current?.contains(target)) return;
      // 点在网格外:收起来。监听挂在 document 上是为了接住拖选时落在网格外的
      // 抬手 —— 代价是应用里任何一次点击都会走到这儿。
      if (!target || !gridWrapRef.current?.contains(target)) {
        setAskAnchor(null);
        return;
      }
      // 把 AG-Grid 的区域展开成"哪些行、哪些列"——判定交给 resolveSelectionScope,
      // 这里只负责读形状。
      const rowKeys = new Set<string>();
      const columns = new Set<string>();
      for (const r of api.getCellRanges?.() ?? []) {
        r.columns.forEach((c) => { const id = c.getColId?.(); if (id) columns.add(id); });
        const from = Math.min(r.startRow?.rowIndex ?? 0, r.endRow?.rowIndex ?? 0);
        const to = Math.max(r.startRow?.rowIndex ?? 0, r.endRow?.rowIndex ?? 0);
        for (let i = from; i <= to; i += 1) {
          const key = (api.getDisplayedRowAtIndex?.(i)?.data as TableRow | undefined)?.row_id;
          if (key) rowKeys.add(String(key));
        }
      }
      const range: SelectionScope = { rowKeys: [...rowKeys], columns: [...columns] };
      setRangeShape(range);
      const scope = resolveSelectionScope({
        range,
        checkedRowKeys: (api.getSelectedNodes?.() ?? [])
          .map((n) => String((n.data as TableRow | undefined)?.row_id ?? ''))
          .filter(Boolean),
        selectedColumnKey: selectedColumnKeyRef.current,
      });
      const action = askBubbleAction({ insideGrid: true, insideBubble: false, scope });
      if (action !== 'show') {
        setAskAnchor(null);
        return;
      }
      setAskAnchor({ top: e.clientY, left: e.clientX });
    };
    document.addEventListener('mouseup', onUp);
    return () => document.removeEventListener('mouseup', onUp);
  }, []);


  const askBubble =
    askAnchor && canReference
      ? createPortal(
          <div
            ref={askBubbleRef}
            className="fixed z-[210]"
            style={{ top: Math.max(8, askAnchor.top - 44), left: askAnchor.left }}
          >
            <Button
              type="button"
              size="sm"
              className="gap-1 shadow-md"
              onClick={referenceSelection}
            >
              <AtSign className="size-3" />
              {t('table.referenceSelection')}
            </Button>
          </div>,
          document.body,
        )
      : null;

  const rowActionDelete = selectedRows.size > 0;
  const selectedColumn = columnDefs.find((c) => c.key === selectedColumnKey);
  const columnSelected = Boolean(selectedColumnKey && selectedColumn);

  const handleRowAction = () => {
    if (rowActionDelete) void handleDeleteRows();
    else void handleAddRow();
  };

  const handleColumnAction = () => {
    if (columnSelected) void handleDeleteColumn();
    else openAddColumnDialog();
  };

  const activeSheetName =
    sheets.find((s) => s.id === activeSheetId)?.name ?? activeSheetId;

  const handleExportExcel = () => {
    void (async () => {
      try {
        const { path } = await exportTableToExcel(activeSheetName, columnDefs, rows);
        showToast(t('table.exportSuccess', { path }), 'success');
      } catch (e: unknown) {
        showToast(e instanceof Error ? e.message : t('table.importFailed'), 'error');
      }
    })();
  };

  const handleImportFileSelected = (file: File) => {
    setPendingImportFile(file);
    setImportConfirmOpen(true);
  };

  const cancelImport = useCallback(() => {
    setImportConfirmOpen(false);
    setPendingImportFile(null);
    resetImportInput();
  }, [resetImportInput]);

  /**
   * 快照:把当前 sheet 写成一份不可变文件落进项目文件夹(spec §5)。
   * 连接器视图是会腐烂的缓存 —— 这是"我要当时那一份"的唯一正解。
   */
  const handleSnapshot = async () => {
    setSnapshotting(true);
    try {
      const res = await fetch('/api/table/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheet: activeSheetId, threadId }),
      });
      const data = (await res.json()) as { ok?: boolean; path?: string; rows?: number; message?: string };
      if (!res.ok || !data.ok) {
        showToast(data.message ?? t('table.snapshotFailed'), 'error');
        return;
      }
      showToast(t('table.snapshotDone', { rows: data.rows ?? 0 }), 'success');
      if (data.path) void revealPath(data.path, threadId);
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : t('table.snapshotFailed'), 'error');
    } finally {
      setSnapshotting(false);
    }
  };

  const handleImportFile = async (file: File) => {
    setImporting(true);
    try {
      const { rows: importedRows, columnNames } = await parseTableExcelFile(file);
      if (columnNames.length === 0 || importedRows.length === 0) {
        showToast(t('table.importEmpty'), 'error');
        return;
      }
      // 原件字节一起送上去:服务端按内容哈希留档进项目文件夹(spec §3「导入即留档」)。
      // 解析仍在前端做 —— 服务端只需要字节来存档,不重复解析一遍。
      const base64 = await fileToBase64(file);
      const res = await fetch('/api/table/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sheet: activeSheetId,
          column_names: columnNames,
          rows: importedRows,
          threadId,
          file: { name: file.name, base64 },
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        columns?: TableColumnDef[];
        rows?: TableRow[];
        archived?: boolean;
        archiveNote?: string;
      };
      if (!res.ok || !data.ok) {
        showToast(data.message ?? t('table.importFailed'), 'error');
        return;
      }
      resetSheetUiState();
      if (data.columns) setColumnDefs(data.columns);
      if (data.rows) {
        editingUntil.current = Date.now() + 5000;
        lastSerialized.current = JSON.stringify(data.rows);
        setRows(data.rows);
      }
      showToast(
        t('table.importSuccess', { count: data.rows?.length ?? importedRows.length }),
        'success',
      );
      // 没留档要说出来 —— 用户以为"原件存好了"而其实没有,是最坏的一种沉默。
      if (data.archived === false && data.archiveNote) {
        setTimeout(() => showToast(data.archiveNote!, 'note'), 1200);
      }
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : t('table.importFailed'), 'error');
    } finally {
      setImporting(false);
      setPendingImportFile(null);
      resetImportInput();
    }
  };

  const confirmImport = () => {
    const file = pendingImportFile;
    if (!file) return;
    setImportConfirmOpen(false);
    void handleImportFile(file);
  };

  const hasActiveFilters = filters.query.trim() !== '' || columnFilterActive;

  if ((compassLoading || loading) && rows.length === 0 && columnDefs.length === 0) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        {compassLoading ? t('table.loadingCompass') : t('table.loading')}
      </div>
    );
  }

  // 这个作用域还没有表。说现状和下一步就够了 —— 不解释归属机制。
  if (sheets.length === 0 && rows.length === 0 && columnDefs.length === 0) {
    return (
      <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-1 px-6 text-center text-sm">
        <span>{t('table.scopeEmpty')}</span>
        <span className="text-xs opacity-70">{t('table.scopeEmptyHint')}</span>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {askBubble}
      {loadError ? (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive/10 text-destructive shrink-0 border-b px-3 py-2 text-xs"
        >
          {t('table.loadError', { error: loadError })}
        </div>
      ) : null}
      {compassLoading && rows.length > 0 ? (
        <div className="border-border bg-muted/40 text-muted-foreground flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-xs">
          <Loader2 className="size-3 shrink-0 animate-spin" />
          <span className="min-w-0 flex-1 truncate">{t('table.loadingCompass')}</span>
        </div>
      ) : null}
      {inboxPending.length > 0 ? (
        <div className="border-border bg-muted/40 text-muted-foreground flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-xs">
          <FolderPlus className="size-3 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {t('table.inboxPending', {
              count: inboxPending.length,
              names: inboxPending.slice(0, 3).map((f) => f.name).join('、'),
            })}
          </span>
          <button
            type="button"
            className="hover:text-foreground shrink-0 underline underline-offset-2"
            onClick={() => setInboxPending([])}
          >
            {t('table.inboxDismiss')}
          </button>
        </div>
      ) : null}
      {toast ? (
        <div
          role="status"
          className={cn(
            'absolute bottom-3 left-1/2 z-50 max-w-[min(90vw,28rem)] -translate-x-1/2 rounded-md px-3 py-2 text-center text-xs shadow-md',
            toast.variant === 'success' && 'bg-primary text-primary-foreground',
            toast.variant === 'error' && 'bg-destructive text-white',
            // 陈述:低调、可读,不抢注意力。
            toast.variant === 'note' && 'bg-foreground/85 text-background',
          )}
        >
          {toast.message}
        </div>
      ) : null}
      {/* Sheet tabs — top */}
      <div
        data-testid="sheet-tabs"
        className="border-border flex shrink-0 items-center gap-1 border-b px-2 py-1.5"
      >
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {sheets.map((sheet) => {
            const active = activeSheetId === sheet.id;
            return (
              <div
                key={sheet.id}
                className={cn(
                  'group/tab flex shrink-0 items-center rounded-md text-xs transition-colors',
                  '[&:hover_.sheet-tab-close]:ml-0.5 [&:hover_.sheet-tab-close]:max-w-5 [&:hover_.sheet-tab-close]:opacity-100',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <button
                  type="button"
                  onClick={() => switchSheet(sheet.id)}
                  className="sheet-tab-label py-1 pl-2.5 pr-1 transition-[padding] duration-150"
                >
                  {sheet.name}
                </button>
                {sheets.length > 1 ? (
                  <button
                    type="button"
                    aria-label={t('table.deleteSheet', { name: sheet.name })}
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteSheetTarget(sheet);
                    }}
                    className={cn(
                      'sheet-tab-close mr-1 overflow-hidden rounded-md p-0.5 transition-all duration-150',
                      'max-w-0 opacity-0',
                      active ? 'hover:bg-primary-foreground/20' : 'hover:bg-foreground/10',
                    )}
                  >
                    <X className="size-3" />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
        <button
          type="button"
          aria-label={t('table.newSheet')}
          onClick={openAddSheetDialog}
          className="text-muted-foreground hover:bg-muted hover:text-foreground ml-1 flex size-7 shrink-0 items-center justify-center rounded-md border border-transparent transition-colors"
        >
          <Plus className="size-3.5" />
        </button>
      </div>

      {/* Toolbar + search */}
      <div className="border-border shrink-0 space-y-2 border-b px-2 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(
              'h-7 gap-1 px-2 text-xs',
              rowActionDelete && 'text-destructive hover:text-destructive',
            )}
            onClick={handleRowAction}
          >
            {rowActionDelete ? <Minus className="size-3" /> : <Plus className="size-3" />}
            {rowActionDelete && selectedRows.size > 1
              ? t('table.rowsN', { count: selectedRows.size })
              : t('table.rows')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(
              'h-7 gap-1 px-2 text-xs',
              columnSelected && 'text-destructive hover:text-destructive',
            )}
            onClick={handleColumnAction}
          >
            {columnSelected ? <Minus className="size-3" /> : <Plus className="size-3" />}
            {t('table.columns')}
          </Button>
          <span className="text-muted-foreground mx-1 hidden h-4 w-px bg-border sm:inline-block" />
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            disabled={importing}
          >
            <label className={cn(importing && 'pointer-events-none opacity-50')}>
              <Upload className="size-3" />
              {importing ? t('table.importing') : t('table.import')}
              <input
                ref={importInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                disabled={importing}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImportFileSelected(file);
                }}
              />
            </label>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={handleExportExcel}
          >
            <Download className="size-3" />
            {t('table.export')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={handleSnapshot}
            disabled={snapshotting}
          >
            <Camera className="size-3" />
            {t('table.snapshot')}
          </Button>
          <span className="text-muted-foreground mx-1 hidden h-4 w-px bg-border sm:inline-block" />
          <div className="relative min-w-[8rem] flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2" />
            <input
              type="search"
              placeholder={t('table.filterPlaceholder')}
              value={filters.query}
              onChange={(e) => setFilters({ query: e.target.value })}
              className="bg-background border-input h-7 w-full rounded-md border pl-7 pr-2 text-xs outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          {hasActiveFilters ? (
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground text-xs underline"
              onClick={clearAllFilters}
            >
              {t('table.clear')}
            </button>
          ) : null}
          <div className="ml-auto flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={t('table.undo')}
              disabled={undoStack.length === 0}
              onClick={handleUndo}
            >
              <Undo2 className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={t('table.redo')}
              disabled={redoStack.length === 0}
              onClick={handleRedo}
            >
              <Redo2 className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* B2 draft bar — schedule sheet only, when Compass draft has pending ops */}
      {isSheet(activeSheetId, SCHEDULE_SHEET_ID) && draftOps > 0 ? (
        <div className="border-border bg-muted/50 flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-xs">
          <span className="text-muted-foreground">
            {t('table.draftBar', { count: draftOps })}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={() => void openPreview()}>
              {t('table.draftPreview')}
            </Button>
            <Button type="button" size="sm" className="h-6 px-2 text-xs" disabled={committing} onClick={() => void commitDraft()}>
              {t('table.draftCommit')}
            </Button>
            <Button type="button" variant="outline" size="sm" className="text-destructive hover:text-destructive h-6 px-2 text-xs" onClick={() => void discardDraft()}>
              {t('table.draftDiscard')}
            </Button>
          </div>
        </div>
      ) : null}

      {loading && rows.length === 0 ? (
        <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 text-sm">
          <Loader2 className="size-5 animate-spin opacity-60" />
          <span>{t('table.loading', { defaultValue: '加载排产数据…' })}</span>
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 text-sm">
          <span>
            {columnDefs.length === 0
              ? t('table.noColumns')
              : rows.length === 0
                ? t('table.noData')
                : t('table.noMatch')}
          </span>
          {columnDefs.length === 0 ? (
            <Button type="button" variant="outline" size="sm" onClick={openAddColumnDialog}>
              {t('table.addFirstColumn')}
            </Button>
          ) : rows.length === 0 ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void handleAddRow()}>
              {t('table.addFirstRow')}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden" ref={gridWrapRef}>
          <div className="min-h-0 flex-1 text-sm" style={{ height: '100%' }}>
            <AgGridReact<TableRow>
              key={proMasterDetail ? 'grid-md' : 'grid-plain'}
              theme={veylinGridTheme}
              // 排产表一次灌进约 3 万行:fitCellContents 会按内容扫列宽,首屏比
              // 翻页贵一个数量级。用列定义自己的 width。其它小表仍按内容撑开,
              // 避免表头被裁成「订...」。
              autoSizeStrategy={
                isSheet(activeSheetId, SCHEDULE_SHEET_ID)
                  ? undefined
                  : { type: 'fitCellContents' }
              }
              rowData={filteredRows}
              columnDefs={agColDefs}
              // 第一页 500 先上屏,其余后台续灌;分页只决定一屏看多少。
              pagination
              paginationPageSize={500}
              paginationPageSizeSelector={[100, 500, 2000, 10000]}
              // Left accent stripe: red = past due (end > due_at), amber = at-risk
              // (within the buffer). No-op on rows/sheets without both fields.
              rowClassRules={{
                'sched-late': (p) => scheduleLateness(p.data) === 'late',
                'sched-atrisk': (p) => scheduleLateness(p.data) === 'atrisk',
              }}
              // External filter for the cockpit drill: "late" is a computed
              // predicate (scheduleLateness), not a column value, so it can't be a
              // setFilterModel entry. Present only while positioned to a late drill.
              isExternalFilterPresent={() => isLateOnlyGridFilter(activeGridFilterRef.current)}
              doesExternalFilterPass={(node) => scheduleLateness(node.data) === 'late'}
              getRowId={(params: GetRowIdParams<TableRow>) => rowKey(params.data)}
              rowSelection={rowSelection}
              selectionColumnDef={{
                suppressHeaderMenuButton: true,
                suppressMovable: true,
                lockPinned: true,
                width: 48,
                minWidth: 44,
                maxWidth: 64,
              }}
              masterDetail={proMasterDetail || undefined}
              // Expander only on rows whose order has 三级 ops (_wo_count > 0). FAIL-OPEN
              // when _wo_count is absent (sheet loaded before the field existed / other
              // sheets) so the affordance isn't silently lost — reload to get true gating.
              isRowMaster={
                proMasterDetail
                  ? (data: TableRow) => {
                      const c = (data as Record<string, unknown>)?.['_wo_count'];
                      return c === undefined ? true : Number(c) > 0;
                    }
                  : undefined
              }
              detailCellRenderer={proMasterDetail ? ScheduleDetailPanel : undefined}
              // Detail panel sizes to its 三级 ops (<30 rows) instead of a fixed
              // 300px box that fills with empty space — AG-Grid master-detail-height guidance.
              detailRowAutoHeight={proMasterDetail || undefined}
              onGridReady={onGridReady}
              onModelUpdated={onModelUpdated}
              onCellValueChanged={onCellValueChanged}
              onCellKeyDown={onGridCellKeyDown}
              onSelectionChanged={onSelectionChanged}
              onCellClicked={onCellClicked}
              {...proGridProps}
            />
          </div>
          <TableGridFooter totals={totals} />
        </div>
      )}

      <Dialog
        open={addSheetOpen}
        onOpenChange={(open) => {
          if (addingSheet) return;
          setAddSheetOpen(open);
          if (!open) setNewSheetName('');
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('table.newSheet')}</DialogTitle>
            <DialogDescription>{t('table.newSheetName')}</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={newSheetName}
            onChange={(e) => setNewSheetName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newSheetName.trim()) void submitAddSheet();
            }}
            placeholder={t('table.newSheetName')}
          />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={addingSheet}
              onClick={() => {
                setAddSheetOpen(false);
                setNewSheetName('');
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              disabled={addingSheet || !newSheetName.trim()}
              onClick={() => void submitAddSheet()}
            >
              {t('common.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={addColumnOpen}
        onOpenChange={(open) => {
          if (addingColumn) return;
          setAddColumnOpen(open);
          if (!open) setNewColumnName('');
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('table.addFirstColumn')}</DialogTitle>
            <DialogDescription>{t('table.newColumnName')}</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={newColumnName}
            onChange={(e) => setNewColumnName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newColumnName.trim()) void submitAddColumn();
            }}
            placeholder={t('table.newColumnName')}
          />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={addingColumn}
              onClick={() => {
                setAddColumnOpen(false);
                setNewColumnName('');
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              disabled={addingColumn || !newColumnName.trim()}
              onClick={() => void submitAddColumn()}
            >
              {t('common.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteSheetTarget != null}
        onOpenChange={(open) => {
          if (!open && !deletingSheet) setDeleteSheetTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {deleteSheetTarget
                ? t('table.deleteSheet', { name: deleteSheetTarget.name })
                : ''}
            </DialogTitle>
            <DialogDescription>{t('table.confirmDeleteSheet')}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={deletingSheet}
              onClick={() => setDeleteSheetTarget(null)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deletingSheet}
              onClick={() => void confirmDeleteSheet()}
            >
              {t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={importConfirmOpen}
        onOpenChange={(open) => {
          if (!open) cancelImport();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('table.import')}</DialogTitle>
            <DialogDescription>{t('table.confirmImport')}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={cancelImport}>
              {t('common.cancel')}
            </Button>
            <Button type="button" disabled={importing} onClick={confirmImport}>
              {t('table.import')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('table.previewTitle')}</DialogTitle>
            <DialogDescription>
              {previewLoading
                ? t('table.previewLoading')
                : previewData && previewData.rows.length === 0
                  ? t('table.previewEmpty')
                  : previewData
                    ? `${t('table.previewStatus')}: ${honestStatusLabel(t, previewData.diagnosis['honest_status'])} · ${t('table.previewUnscheduled')}: ${String(previewData.diagnosis['unscheduled'] ?? 0)}`
                    : ''}
            </DialogDescription>
          </DialogHeader>
          {previewData && previewData.rows.length > 0 ? (
            <div className="max-h-80 overflow-auto text-xs">
              <div className="text-muted-foreground mb-1">
                {t('table.previewAffected', { count: previewData.rows.length })}
              </div>
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-border border-b text-left">
                    {PREVIEW_COLUMNS.filter((c) => c.key in (previewData.rows[0] ?? {})).map((c) => (
                      <th key={c.key} className="px-2 py-1 font-medium">{t(c.labelKey)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewData.rows.slice(0, 50).map((r, i) => (
                    <tr key={i} className="border-border/50 border-b">
                      {PREVIEW_COLUMNS.filter((c) => c.key in (previewData.rows[0] ?? {})).map((c) => (
                        <td key={c.key} className="px-2 py-1">{String(r[c.key] ?? '')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => setPreviewOpen(false)}>
              {t('common.close')}
            </Button>
            <Button type="button" size="sm" disabled={committing || previewLoading} onClick={() => void commitDraft()}>
              {t('table.draftCommit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
