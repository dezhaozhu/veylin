import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { Plus, Minus, Redo2, Undo2, Upload, Download, X, Loader2, Search } from 'lucide-react';
import { AgGridReact } from 'ag-grid-react';
import {
  type ColDef,
  type GetRowIdParams,
  type ValueFormatterParams,
  type ICellRendererParams,
  type CellClassParams,
  type CellValueChangedEvent,
  type CellKeyDownEvent,
  type IHeaderParams,
  type GridApi,
  type GridReadyEvent,
  type FirstDataRenderedEvent,
  themeQuartz,
} from 'ag-grid-community';
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
const SCHEDULE_SHEET_ID = 'schedule';
const ORDER_SHEET_ID = 'orders';

// Grid theme tuned to Veylin's identity: the app's system font + its shadcn CSS
// variables (so the grid tracks light/dark automatically), tighter density, a
// clean borderless look (hairline row separators, no vertical gridlines, no heavy
// header fill), and the app's neutral accent for selection/focus.
const veylinGridTheme = themeQuartz.withParams({
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  fontSize: 12.5,
  spacing: 7,
  rowHeight: 36,
  headerHeight: 40,
  backgroundColor: 'var(--background)',
  foregroundColor: 'var(--foreground)',
  borderColor: 'color-mix(in oklab, var(--border) 80%, transparent)',
  chromeBackgroundColor: 'var(--muted)',
  // Soft header band so the grid reads less like a raw spreadsheet dump.
  headerBackgroundColor: 'color-mix(in oklab, var(--muted) 45%, var(--background))',
  headerTextColor: 'var(--muted-foreground)',
  headerFontWeight: 600,
  headerFontSize: 11.5,
  // Flat rows — no zebra; separators + hover carry hierarchy.
  oddRowBackgroundColor: 'var(--background)',
  rowHoverColor: 'color-mix(in oklab, var(--muted) 65%, transparent)',
  selectedRowBackgroundColor: 'color-mix(in oklab, var(--accent) 75%, transparent)',
  accentColor: 'var(--primary)',
  cellTextColor: 'var(--foreground)',
  wrapperBorderRadius: 10,
  wrapperBorder: true,
  columnBorder: false,
  borderRadius: 6,
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
  // Scheduling vocabulary (used when Compass omits column semantics)
  solved: 'positive',
  derived: 'info',
  unscheduled: 'neutral',
  scheduled: 'positive',
  feasible: 'positive',
  infeasible: 'negative',
  not_scheduled: 'neutral',
};

function statusClass(value: string, semantics?: Record<string, string>): string {
  const tone = (semantics?.[value] as StatusTone | undefined) ?? FALLBACK_TONE[value] ?? 'neutral';
  return TONE_STYLE[tone] ?? TONE_STYLE.neutral;
}

function humanizeStatus(value: string): string {
  return value.replace(/_/g, ' ');
}

/** Date-like column keys — give them room and show YYYY-MM-DD instead of ISO spam. */
function isDateishColumn(key: string): boolean {
  return /(^|_)(at|date|end|start|due|time)(_|$)/i.test(key) || /完工|交期|日期/.test(key);
}

function formatTableCellValue(key: string, value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  const s = String(value);
  if (isDateishColumn(key) || /^\d{4}-\d{2}-\d{2}T/.test(s)) {
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  }
  return s;
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

async function fetchSchedule(sheetId: string): Promise<SchedulePayload> {
  const res = await fetch(`/api/table?sheet=${encodeURIComponent(sheetId)}`);
  const data = await readJsonResponse<SchedulePayload>(res);
  if (!res.ok) {
    throw new Error((data as { message?: string }).message ?? `HTTP ${res.status}`);
  }
  return data;
}

async function patchRow(sheetId: string, row: TableRow): Promise<boolean> {
  try {
    const res = await fetch('/api/table', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheet: sheetId, row_key: rowKey(row), ...row }),
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
        {t('table.footerTotal', { count: totals.rowCount })}
      </span>
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
        'inline-flex max-w-full items-center truncate rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 ring-1 ring-inset ring-black/5 dark:ring-white/10',
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

  // Empty / loading: one quiet line — never a big empty card.
  if (rows === null) {
    return (
      <div className="text-muted-foreground py-1 pl-12 pr-3 text-[11px]">加载中…</div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="text-muted-foreground py-1 pl-12 pr-3 text-[11px]">暂无三级工艺明细</div>
    );
  }

  return (
    <div className="veylin-schedule-detail border-border/50 ml-10 mr-2 border-l-2 py-0.5 pl-3">
      <div className="text-muted-foreground mb-0.5 flex items-center gap-3 px-1 text-[10px]">
        <span className="w-7 shrink-0">#</span>
        <span className="min-w-[7rem] shrink-0">工序</span>
        <span className="min-w-[6rem] shrink-0">资源</span>
        <span className="w-20 shrink-0">状态</span>
        <span className="ml-auto shrink-0">计划</span>
      </div>
      {rows.map((op, i) => (
        <div
          key={i}
          className="hover:bg-muted/50 flex items-center gap-3 rounded-sm px-1 py-0.5 text-xs"
        >
          <span className="text-muted-foreground w-7 shrink-0 tabular-nums">
            {String(op['op_seq'] ?? '')}
          </span>
          <span className="min-w-[7rem] shrink-0 font-medium">{String(op['op_name'] ?? '-')}</span>
          <span className="text-muted-foreground min-w-[6rem] shrink-0">
            {String(op['resource_id'] ?? '')}
          </span>
          <span className="w-20 shrink-0">
            <StatusBadge status={String(op['status'] ?? '')} semantics={semantics} />
          </span>
          <span className="text-muted-foreground ml-auto shrink-0 tabular-nums">
            {day(op['planned_start'])}
            {day(op['planned_end']) ? ` → ${day(op['planned_end'])}` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

// AG-Grid v36 custom header: name click → column selection.
// Sort chevrons are omitted — browsing / filtering is the primary job here;
// column filters stay on the native header menu button.
interface AgColumnHeaderParams extends IHeaderParams<TableRow> {
  columnKey: string;
  onSelect: (key: string | null) => void;
  selectedKeyRef: { current: string | null };
}

function AgColumnHeader(params: AgColumnHeaderParams) {
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
  const [sheets, setSheets] = useState<TableSheet[]>([]);
  const [activeSheetId, setActiveSheetId] = useState('main');
  const [columnDefs, setColumnDefs] = useState<TableColumnDef[]>([]);
  const [rows, setRows] = useState<TableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [compassLoading, setCompassLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  // Rows actually shown after AG-Grid's column filters (the search box pre-filters
  // rowData; column filters narrow further inside the grid). null until first render.
  const [displayedCount, setDisplayedCount] = useState<number | null>(null);
  const [columnFilterActive, setColumnFilterActive] = useState(false);
  const [undoStack, setUndoStack] = useState<HistoryBatch[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryBatch[]>([]);
  const [selectedColumnKey, setSelectedColumnKey] = useState<string | null>(null);

  const lastSerialized = useRef('');
  const editingUntil = useRef(0);
  const isApplyingHistory = useRef(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  // AG-Grid API ref — populated in onGridReady
  const gridApiRef = useRef<GridApi<TableRow> | null>(null);
  // Per-sheet column widths after first autosize — revisit applies immediately (no jump).
  const columnWidthCacheRef = useRef<Map<string, Record<string, number>>>(new Map());
  // Ref mirror of selectedColumnKey — read by AgColumnHeader on refreshHeader()
  const selectedColumnKeyRef = useRef<string | null>(null);
  // Ref mirror of rows — used in async paste handler to avoid stale closure
  const rowsRef = useRef<TableRow[]>(rows);
  const sseErrorNotified = useRef(false);
  // Agent-requested chart waiting for the target sheet's rows to be on screen
  const pendingChartRef = useRef<{
    sheet: string;
    columns: string[];
    chartType: string;
    aggFunc?: string;
  } | null>(null);

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

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const [importing, setImporting] = useState(false);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const [importConfirmOpen, setImportConfirmOpen] = useState(false);
  const [addColumnOpen, setAddColumnOpen] = useState(false);
  const [newColumnName, setNewColumnName] = useState('');
  const [addingColumn, setAddingColumn] = useState(false);
  const [toast, setToast] = useState<{ message: string; variant: 'success' | 'error' } | null>(
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

  const showToast = useCallback((message: string, variant: 'success' | 'error') => {
    setToast({ message, variant });
  }, []);

  const resetImportInput = useCallback(() => {
    if (importInputRef.current) importInputRef.current.value = '';
  }, []);

  const editableKeys = useMemo(() => new Set(columnDefs.map((c) => c.key)), [columnDefs]);

  // Column selection — syncs React state + ref, then refreshes AG-Grid headers
  const selectColumn = useCallback((key: string | null) => {
    setSelectedColumnKey(key);
    selectedColumnKeyRef.current = key;
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
    setUndoStack([]);
    setRedoStack([]);
    setSelectedColumnKey(null);
    selectedColumnKeyRef.current = null;
    lastSerialized.current = '';
    setDraftOps(0);
    setPreviewOpen(false);
    setPreviewData(null);
  }, []);

  const applyPayload = useCallback((data: SchedulePayload, initial: boolean) => {
    if (data.sheets?.length) {
      setSheets(data.sheets);
      // Empty default Sheet 1 may be pruned after Compass import — follow the
      // sheet the server actually returned / the first remaining tab.
      setActiveSheetId((current) => {
        if (data.sheets!.some((s) => s.id === current)) return current;
        if (data.sheet && data.sheets!.some((s) => s.id === data.sheet)) return data.sheet;
        return data.sheets![0]!.id;
      });
    }
    if (data.columns) setColumnDefs(data.columns);
    const next = data.rows ?? [];
    if (initial) setLoading(false);
    if (Date.now() < editingUntil.current) return;
    const serialized = JSON.stringify(next);
    if (serialized === lastSerialized.current) return;
    lastSerialized.current = serialized;
    setRows(next);
  }, []);

  const load = useCallback(
    async (sheetId: string, initial: boolean) => {
      const attempts = initial ? 6 : 1;
      for (let i = 0; i < attempts; i++) {
        try {
          const data = await fetchSchedule(sheetId);
          applyPayload(data, initial);
          if (initial) setLoadError(null);
          return;
        } catch (err) {
          if (i < attempts - 1) {
            await sleep(400 * (i + 1));
            continue;
          }
          if (initial) {
            const message = err instanceof Error ? err.message : t('table.loadFailedGeneric');
            // Inline banner only — avoid a second solid-red toast for the same failure.
            setLoadError(message);
            applyPayload(emptySchedulePayload(sheetId), true);
          }
        }
      }
    },
    [applyPayload, showToast, t],
  );

  const switchSheet = useCallback(
    (sheetId: string) => {
      if (sheetId === activeSheetId) return;
      resetSheetUiState();
      // Drop previous sheet immediately — same AgGrid instance would otherwise
      // keep painting old rows until fetch returns, then autosize jumps again.
      lastSerialized.current = '';
      setRows([]);
      setColumnDefs([]);
      setDisplayedCount(null);
      setActiveSheetId(sheetId);
      setLoading(true);
    },
    [activeSheetId, resetSheetUiState],
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
          setActiveSheetId(data.sheet);
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
          setBootstrapped(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showToast, t]);

  // Live sync: SSE push + row-level deltas replaces the old 4s full-sheet poll, so
  // update cost is independent of sheet size (loading the full 30k-row schedule is cheap).
  useEffect(() => {
    if (!bootstrapped) return;
    void load(activeSheetId, true);
    const es = new EventSource('/api/table/stream');
    es.onopen = () => {
      sseErrorNotified.current = false;
      // (re)connected — one full resync catches anything missed while disconnected.
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
        void load(activeSheetId, false); // bulk import / column change — full refetch
      }
    };
    es.onerror = () => {
      if (sseErrorNotified.current) return;
      sseErrorNotified.current = true;
      showToast(t('table.sseDisconnected'), 'error');
    };
    return () => es.close();
  }, [activeSheetId, load, bootstrapped, showToast, t]);

  // A pending agent chart draws once its target sheet's rows have loaded.
  useEffect(() => {
    if (pendingChartRef.current?.sheet === activeSheetId && rows.length > 0) {
      drawPendingChart();
    }
  }, [rows, activeSheetId, drawPendingChart]);

  // Pre-filter rows in React (search box); column filters stay inside AG-Grid.
  const filteredRows = useMemo(() => applyFilters(rows, filters), [rows, filters]);

  const totals = useMemo<TableGridTotals>(
    () => ({
      rowCount: displayedCount ?? filteredRows.length,
    }),
    [displayedCount, filteredRows.length],
  );

  const commitRows = useCallback(
    (merged: TableRow[], touchedKeys: ReadonlySet<string>) => {
      lastSerialized.current = JSON.stringify(merged);
      editingUntil.current = Date.now() + 3000;
      setRows(merged);
      for (const row of merged) {
        if (touchedKeys.has(rowKey(row))) void patchRow(activeSheetId, row);
      }
    },
    [activeSheetId],
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
        for (const row of merged) {
          if (touched.has(rowKey(row))) void patchRow(activeSheetId, row);
        }
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
      if (activeSheetId === SCHEDULE_SHEET_ID) {
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
      // Paste: read clipboard, coerce to column type, commit via patchRow
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

  const onGridReady = useCallback((event: GridReadyEvent<TableRow>) => {
    gridApiRef.current = event.api;
  }, []);

  const persistColumnWidths = useCallback((sheetId: string) => {
    const api = gridApiRef.current;
    if (!api) return;
    const widths: Record<string, number> = {};
    for (const s of api.getColumnState()) {
      if (!s.colId || s.colId.startsWith('__') || s.width == null) continue;
      widths[s.colId] = s.width;
    }
    if (Object.keys(widths).length > 0) {
      columnWidthCacheRef.current.set(sheetId, widths);
    }
  }, []);

  // After first paint / autosize strategy: remember widths so the next visit
  // to this sheet applies them on ColDef (no second layout pass).
  const onFirstDataRendered = useCallback(
    (_event: FirstDataRenderedEvent<TableRow>) => {
      persistColumnWidths(activeSheetId);
    },
    [activeSheetId, persistColumnWidths],
  );

  const onColumnResized = useCallback(
    (event: { finished?: boolean }) => {
      if (event.finished) persistColumnWidths(activeSheetId);
    },
    [activeSheetId, persistColumnWidths],
  );

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

  // Clear BOTH the global search and every AG-Grid column filter.
  const clearAllFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    gridApiRef.current?.setFilterModel(null);
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
    (activeSheetId === SCHEDULE_SHEET_ID || activeSheetId === ORDER_SHEET_ID) && proEnterprise;

  // Generic Enterprise affordances for EVERY sheet (no sheet-specific logic —
  // Veylin stays a generic host): drag-to-group row grouping, columns/filters
  // side panels, cell range selection, "Chart Range" from the context menu, and
  // a selection-aggregation status bar. Only when Enterprise is licensed+loaded.
  const proGridProps = useMemo(() => {
    if (!proEnterprise) return {};
    return {
      // Only show the drop zone once the user is actually grouping — permanent
      // empty strip made the toolbar feel like three stacked chrome bands.
      rowGroupPanelShow: 'onlyWhenGrouping' as const,
      cellSelection: true,
      enableCharts: true,
      defaultColDef: { enableRowGroup: true, enableValue: true, enablePivot: true },
      sideBar: {
        toolPanels: ['columns', 'filters'],
        // Collapsed by default; open via the edge tabs when needed.
        hiddenByDefault: true,
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

    // Pinned row-number column (read-only, no sort). Skip master-detail child
    // rows so expanding a order doesn't steal numbers (4 → 6 / duplicate 6).
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
      suppressMovable: true,
      enableRowGroup: false,
      enableValue: false,
      enablePivot: false,
      suppressHeaderFilterButton: true,
      suppressAutoSize: true,
      valueGetter: (p) => {
        const target = p.node;
        if (!target || target.detail) return '';
        const api = p.api;
        if (!api) return (target.rowIndex ?? 0) + 1;
        const first = api.getFirstDisplayedRowIndex();
        const last = api.getLastDisplayedRowIndex();
        let n = 0;
        for (let i = first; i <= last; i++) {
          const node = api.getDisplayedRowAtIndex(i);
          if (!node || node.detail) continue;
          n += 1;
          if (node === target) return n;
        }
        return '';
      },
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
        suppressAutoSize: true,
        cellRenderer: 'agGroupCellRenderer',
      });
    }

    // Cached widths (after first autosize) paint correctly on sheet revisit.
    const widthCache = columnWidthCacheRef.current.get(activeSheetId);

    // Data columns
    for (const def of columnDefs) {
      const isEditable =
        activeSheetId === SCHEDULE_SHEET_ID ? GOVERNED_EDIT_FIELDS.has(def.key) : true;
      const cachedWidth = widthCache?.[def.key];
      const baseColDef: ColDef<TableRow> = {
        field: def.key,
        colId: def.key,
        headerName: def.name,
        // Cache hit → fixed width on first paint (no autosize jump). Miss → hint only.
        ...(cachedWidth != null
          ? { width: cachedWidth, suppressAutoSize: true }
          : { initialWidth: def.width }),
        resizable: true,
        // Browse + filter first; no per-column sort chevrons in this UI.
        sortable: false,
        pinned: def.frozen ? ('left' as const) : undefined,
        editable: isEditable,
        // Hover cue on the schedule sheet's governed-edit cells (改资源/日期→propose).
        cellClass: activeSheetId === SCHEDULE_SHEET_ID && isEditable ? 'veylin-editable' : undefined,
        // Full value on hover — helps any truncated cell (IDs, long names).
        tooltipValueGetter: (p) => (p.value == null || p.value === '' ? null : String(p.value)),
        cellDataType: false,
        suppressHeaderFilterButton: true,
        // Column filters stay available via the Filters tool panel / header menu.
        // Floating filter row under every header made the grid look like three
        // chrome bands stacked on the data — opt out for a calmer default.
        filter: 'agTextColumnFilter',
        floatingFilter: false,
        minWidth: isDateishColumn(def.key) ? 112 : 72,
        valueFormatter: (params: ValueFormatterParams<TableRow>) =>
          formatTableCellValue(def.key, params.value),
        // Custom header: name click selects column (filter via menu button)
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
            // Whisper tint — readable without washing out zebra / selection.
            return { ...base, backgroundColor: `rgba(37, 99, 235, ${(0.035 + t * 0.14).toFixed(3)})` };
          },
        });
      } else if (def.type === 'sparkline' && proEnterprise) {
        // Cell holds a comma-separated numeric series ("3,5,2,…") → in-cell bar
        // trend via AG-Grid Sparklines. Read-only; falls to the text branch when
        // Enterprise isn't licensed/loaded.
        defs.push({
          ...baseColDef,
          editable: false,
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
    if (activeSheetId === SCHEDULE_SHEET_ID && columnDefs.some((d) => d.key === 'start')) {
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

  // First visit (or schema changed) — cached complete sheets skip strategy.
  const autoSizeStrategy = useMemo(() => {
    const cached = columnWidthCacheRef.current.get(activeSheetId);
    const cacheComplete =
      !!cached &&
      columnDefs.length > 0 &&
      columnDefs.every((c) => cached[c.key] != null);
    if (cacheComplete) return undefined;
    if (cached && !cacheComplete) columnWidthCacheRef.current.delete(activeSheetId);
    return {
      type: 'fitCellContents' as const,
      defaultMaxWidth: 360,
    };
  }, [activeSheetId, columnDefs]);

  // (三级 detail is now the ScheduleDetailPanel custom renderer, which fetches on
  // expand — no detailGridOptions/getDetailRowData needed.)

  const handleAddRow = async () => {
    const res = await fetch('/api/table/rows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheet: activeSheetId }),
    });
    const data = (await res.json()) as { ok?: boolean; rows?: TableRow[] };
    if (data.ok && data.rows) {
      editingUntil.current = Date.now() + 3000;
      lastSerialized.current = JSON.stringify(data.rows);
      setRows(data.rows);
    }
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
        body: JSON.stringify({ sheet: activeSheetId, name }),
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
      body: JSON.stringify({ sheet: activeSheetId, key: selectedColumnKey }),
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

  const selectedColumn = columnDefs.find((c) => c.key === selectedColumnKey);
  const columnSelected = Boolean(selectedColumnKey && selectedColumn);

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

  const handleImportFile = async (file: File) => {
    setImporting(true);
    try {
      const { rows: importedRows, columnNames } = await parseTableExcelFile(file);
      if (columnNames.length === 0 || importedRows.length === 0) {
        showToast(t('table.importEmpty'), 'error');
        return;
      }
      const res = await fetch('/api/table/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sheet: activeSheetId,
          column_names: columnNames,
          rows: importedRows,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        columns?: TableColumnDef[];
        rows?: TableRow[];
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

  // Full-page spinner only before any sheet chrome exists. Sheet switches clear
  // rows/cols but keep tabs visible and load inside the grid area.
  if ((compassLoading || loading) && rows.length === 0 && columnDefs.length === 0 && sheets.length === 0) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        {compassLoading ? t('table.loadingCompass') : t('table.loading')}
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {loadError ? (
        <div
          role="alert"
          className="border-border bg-muted/60 text-muted-foreground shrink-0 border-b px-3 py-1.5 text-xs"
        >
          {t('table.loadError', { error: loadError })}
        </div>
      ) : null}
      {toast ? (
        <div
          role="status"
          className={cn(
            'absolute bottom-3 left-1/2 z-50 max-w-[min(90vw,24rem)] -translate-x-1/2 rounded-lg border px-3 py-2 text-center text-xs shadow-sm backdrop-blur-sm',
            'border-border bg-background/95 text-foreground',
            toast.variant === 'error' && 'text-muted-foreground',
          )}
        >
          {toast.message}
        </div>
      ) : null}
      {/* Sheet tabs — top */}
      <div className="border-border flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
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
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => void handleAddRow()}
          >
            <Plus className="size-3" />
            {t('table.rows')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(
              'h-7 gap-1 px-2 text-xs',
              columnSelected && 'text-muted-foreground hover:text-foreground',
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
          <span className="text-muted-foreground mx-1 hidden h-4 w-px bg-border sm:inline-block" />
          <div className="relative min-w-[8rem] flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2" />
            <input
              type="text"
              placeholder={t('table.filterPlaceholder')}
              value={filters.query}
              onChange={(e) => setFilters({ query: e.target.value })}
              className={cn(
                'bg-background border-input h-7 w-full rounded-md border pl-7 text-xs outline-none focus:ring-1 focus:ring-ring',
                hasActiveFilters ? 'pr-7' : 'pr-2',
              )}
            />
            {hasActiveFilters ? (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5"
                aria-label={t('table.clear')}
                title={t('table.clear')}
                onClick={clearAllFilters}
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
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
      {activeSheetId === SCHEDULE_SHEET_ID && draftOps > 0 ? (
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
            <Button type="button" variant="outline" size="sm" className="text-muted-foreground hover:text-foreground h-6 px-2 text-xs" onClick={() => void discardDraft()}>
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
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 text-sm" style={{ height: '100%' }}>
            <AgGridReact<TableRow>
              // Remount per sheet so orders/resources/schedule never share one
              // half-updated grid instance across tab switches.
              key={`grid-${activeSheetId}`}
              theme={veylinGridTheme}
              // First visit: fit contents. Revisit: ColDef.width from cache (no jump).
              autoSizeStrategy={autoSizeStrategy}
              rowData={filteredRows}
              columnDefs={agColDefs}
              // All rows load into the grid (no 500 cap); paginate so large sheets
              // (e.g. shangzhong's ~30k schedule rows) stay navigable + fast.
              pagination
              paginationPageSize={500}
              paginationPageSizeSelector={[100, 500, 2000, 10000]}
              // Left accent stripe: red = past due (end > due_at), amber = at-risk
              // (within the buffer). No-op on rows/sheets without both fields.
              rowClassRules={{
                // Detail rows reuse master data in some AG-Grid versions — never
                // paint lateness stripes on the nested panel.
                'sched-late': (p) =>
                  !p.node?.detail && scheduleLateness(p.data) === 'late',
                'sched-atrisk': (p) =>
                  !p.node?.detail && scheduleLateness(p.data) === 'atrisk',
              }}
              getRowId={(params: GetRowIdParams<TableRow>) => rowKey(params.data)}
              masterDetail={proMasterDetail || undefined}
              // orders 表：有 _wo_count 时按计数决定能否展开；schedule 二级行没有
              // 这个字段，必须 fail-open，否则会整表关掉「二级→三级」展开。
              isRowMaster={
                proMasterDetail
                  ? (data: TableRow) => {
                      const c = (data as Record<string, unknown>)?.['_wo_count'];
                      if (c === undefined || c === null || c === '') return true;
                      return Number(c) > 0;
                    }
                  : undefined
              }
              detailCellRenderer={proMasterDetail ? ScheduleDetailPanel : undefined}
              // Detail panel sizes to its 三级 ops (<30 rows) instead of a fixed
              // 300px box that fills with empty space — AG-Grid master-detail-height guidance.
              detailRowAutoHeight={proMasterDetail || undefined}
              onGridReady={onGridReady}
              onFirstDataRendered={onFirstDataRendered}
              onColumnResized={onColumnResized}
              onModelUpdated={onModelUpdated}
              onCellValueChanged={onCellValueChanged}
              onCellKeyDown={onGridCellKeyDown}
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
          <DialogFooter>
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
          <DialogFooter>
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
          <DialogFooter>
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
          <DialogFooter>
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
