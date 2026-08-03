/** Shared in-memory table query (agent table_get + right-panel search/sort). */

export type TableQueryColumnType = 'text' | 'number' | 'status';

export type TableQueryColumn = {
  key: string;
  name: string;
  type: TableQueryColumnType;
};

export type TableQueryRow = Record<string, string | number> & { row_id?: string };

export const TABLE_FILTER_OPS = [
  'eq',
  'neq',
  'contains',
  'gt',
  'gte',
  'lt',
  'lte',
  'empty',
  'not_empty',
] as const;

export type TableFilterOp = (typeof TABLE_FILTER_OPS)[number];

export type TableColumnFilter = {
  column: string;
  op: TableFilterOp;
  value?: string | number;
};

export const TABLE_AGGREGATE_OPS = ['count', 'sum', 'avg', 'min', 'max'] as const;

export type TableAggregateOp = (typeof TABLE_AGGREGATE_OPS)[number];

export type TableAggregateMetric = {
  op: TableAggregateOp;
  /** Required for sum/avg/min/max; ignored for count when omitted (row count). */
  column?: string;
};

export type TableQueryOptions = {
  query?: string;
  filters?: TableColumnFilter[];
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  /** Column keys or display names to include; `row_id` always kept. */
  columns?: string[];
  rowKeys?: string[];
  aggregate?: {
    metrics: TableAggregateMetric[];
    groupBy?: string;
  };
  offset?: number;
  limit?: number;
};

export type TableQueryRowsResult = {
  mode: 'rows';
  matchedRows: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  rows: TableQueryRow[];
};

export type TableQueryAggregateResult = {
  mode: 'aggregate';
  matchedRows: number;
  matchedGroups: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  groupBy?: string;
  groups: Array<Record<string, string | number | null>>;
};

export type TableQueryResult = TableQueryRowsResult | TableQueryAggregateResult;

export const DEFAULT_TABLE_QUERY_LIMIT = 50;

export function resolveTableQueryColumn(
  columns: readonly TableQueryColumn[],
  ref: string,
): TableQueryColumn | undefined {
  const trimmed = ref.trim();
  if (!trimmed) return undefined;
  const exact = columns.find((c) => c.key === trimmed || c.name === trimmed);
  if (exact) return exact;
  const lower = trimmed.toLowerCase();
  return columns.find((c) => c.key.toLowerCase() === lower || c.name.toLowerCase() === lower);
}

/** Cross-column case-insensitive substring search (right-panel search box). */
export function applyTextQuery<T extends TableQueryRow>(rows: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...rows];
  return rows.filter((row) =>
    Object.values(row).some((v) => String(v ?? '').toLowerCase().includes(q)),
  );
}

export function compareCellValues(
  a: string | number | undefined,
  b: string | number | undefined,
  type: TableQueryColumnType,
): number {
  const aEmpty = a === undefined || a === '';
  const bEmpty = b === undefined || b === '';
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return -1;
  if (bEmpty) return 1;
  if (type === 'number') return Number(a) - Number(b);
  return String(a).localeCompare(String(b), 'zh-CN', { numeric: true });
}

export function sortRows<T extends TableQueryRow>(
  rows: readonly T[],
  columns: readonly TableQueryColumn[],
  sortBy: string | undefined,
  sortDir: 'asc' | 'desc' = 'asc',
): T[] {
  if (!sortBy?.trim()) return [...rows];
  const col = resolveTableQueryColumn(columns, sortBy);
  if (!col) return [...rows];
  const dir = sortDir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => dir * compareCellValues(a[col.key], b[col.key], col.type));
}

function cellEmpty(value: string | number | undefined | null): boolean {
  return value === undefined || value === null || value === '';
}

function matchFilter(
  row: TableQueryRow,
  col: TableQueryColumn,
  filter: TableColumnFilter,
): boolean {
  const raw = row[col.key];
  switch (filter.op) {
    case 'empty':
      return cellEmpty(raw);
    case 'not_empty':
      return !cellEmpty(raw);
    case 'eq':
      return String(raw ?? '') === String(filter.value ?? '');
    case 'neq':
      return String(raw ?? '') !== String(filter.value ?? '');
    case 'contains':
      return String(raw ?? '')
        .toLowerCase()
        .includes(String(filter.value ?? '').toLowerCase());
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      if (cellEmpty(raw) || filter.value === undefined || filter.value === '') return false;
      const left = col.type === 'number' ? Number(raw) : String(raw);
      const right = col.type === 'number' ? Number(filter.value) : String(filter.value);
      if (typeof left === 'number' && typeof right === 'number') {
        if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
        if (filter.op === 'gt') return left > right;
        if (filter.op === 'gte') return left >= right;
        if (filter.op === 'lt') return left < right;
        return left <= right;
      }
      const cmp = String(left).localeCompare(String(right), 'zh-CN', { numeric: true });
      if (filter.op === 'gt') return cmp > 0;
      if (filter.op === 'gte') return cmp >= 0;
      if (filter.op === 'lt') return cmp < 0;
      return cmp <= 0;
    }
    default:
      return true;
  }
}

/** AND all column filters. Unknown columns are skipped (filter ignored). */
export function applyColumnFilters<T extends TableQueryRow>(
  rows: readonly T[],
  columns: readonly TableQueryColumn[],
  filters: readonly TableColumnFilter[] | undefined,
): T[] {
  if (!filters || filters.length === 0) return [...rows];
  const resolved = filters
    .map((f) => {
      const col = resolveTableQueryColumn(columns, f.column);
      return col ? { filter: f, col } : null;
    })
    .filter((x): x is { filter: TableColumnFilter; col: TableQueryColumn } => x != null);
  if (resolved.length === 0) return [...rows];
  return rows.filter((row) => resolved.every(({ filter, col }) => matchFilter(row, col, filter)));
}

export function projectColumns<T extends TableQueryRow>(
  rows: readonly T[],
  columns: readonly TableQueryColumn[],
  projection: readonly string[] | undefined,
): T[] {
  if (!projection || projection.length === 0) {
    return rows.map((r) => ({ ...r }));
  }
  const keys = new Set<string>(['row_id']);
  for (const ref of projection) {
    const col = resolveTableQueryColumn(columns, ref);
    if (col) keys.add(col.key);
  }
  return rows.map((row) => {
    const next: TableQueryRow = { row_id: row.row_id ?? '' };
    for (const key of keys) {
      if (key === 'row_id') continue;
      if (key in row) next[key] = row[key]!;
    }
    return next as T;
  });
}

function metricKey(metric: TableAggregateMetric, index: number): string {
  if (metric.op === 'count' && !metric.column) return 'count';
  const col = metric.column?.trim() || 'value';
  return `${metric.op}_${col}`.replace(/\s+/g, '_') || `metric_${index}`;
}

/** Finite numbers only; skips empty strings (Number('') === 0 must not count). */
function numericValues(rows: readonly TableQueryRow[], key: string): number[] {
  const out: number[] = [];
  for (const row of rows) {
    const raw = row[key];
    if (cellEmpty(raw)) continue;
    if (typeof raw === 'number') {
      if (Number.isFinite(raw)) out.push(raw);
      continue;
    }
    const trimmed = String(raw).trim();
    if (!trimmed) continue;
    const n = Number(trimmed);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

function stringValues(rows: readonly TableQueryRow[], key: string): string[] {
  const out: string[] = [];
  for (const row of rows) {
    const raw = row[key];
    if (cellEmpty(raw)) continue;
    out.push(String(raw));
  }
  return out;
}

function computeMetric(
  rows: readonly TableQueryRow[],
  columns: readonly TableQueryColumn[],
  metric: TableAggregateMetric,
  index: number,
): { key: string; value: string | number | null } {
  const key = metricKey(metric, index);
  if (metric.op === 'count' && !metric.column?.trim()) {
    return { key, value: rows.length };
  }
  const col = metric.column ? resolveTableQueryColumn(columns, metric.column) : undefined;
  if (metric.op === 'count') {
    if (!col) return { key, value: rows.length };
    return {
      key,
      value: rows.filter((r) => !cellEmpty(r[col.key])).length,
    };
  }
  if (!col) return { key, value: null };

  if (col.type === 'number') {
    const nums = numericValues(rows, col.key);
    if (nums.length === 0) return { key, value: null };
    if (metric.op === 'sum') return { key, value: nums.reduce((a, b) => a + b, 0) };
    if (metric.op === 'avg') return { key, value: nums.reduce((a, b) => a + b, 0) / nums.length };
    if (metric.op === 'min') return { key, value: Math.min(...nums) };
    return { key, value: Math.max(...nums) };
  }

  // text / status (including date-like strings): sum/avg unsupported
  if (metric.op === 'sum' || metric.op === 'avg') return { key, value: null };
  const strs = stringValues(rows, col.key);
  if (strs.length === 0) return { key, value: null };
  const sorted = [...strs].sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
  if (metric.op === 'min') return { key, value: sorted[0]! };
  return { key, value: sorted[sorted.length - 1]! };
}

export function aggregateRows(
  rows: readonly TableQueryRow[],
  columns: readonly TableQueryColumn[],
  aggregate: NonNullable<TableQueryOptions['aggregate']>,
): TableQueryAggregateResult['groups'] {
  const metrics = aggregate.metrics ?? [];
  if (metrics.length === 0) {
    return [{ count: rows.length }];
  }

  const groupRef = aggregate.groupBy?.trim();
  if (!groupRef) {
    const group: Record<string, string | number | null> = {};
    metrics.forEach((m, i) => {
      const { key, value } = computeMetric(rows, columns, m, i);
      group[key] = value;
    });
    return [group];
  }

  const groupCol = resolveTableQueryColumn(columns, groupRef);
  if (!groupCol) {
    const group: Record<string, string | number | null> = {};
    metrics.forEach((m, i) => {
      const { key, value } = computeMetric(rows, columns, m, i);
      group[key] = value;
    });
    return [group];
  }

  const buckets = new Map<string, TableQueryRow[]>();
  for (const row of rows) {
    const g = String(row[groupCol.key] ?? '');
    const list = buckets.get(g) ?? [];
    list.push(row);
    buckets.set(g, list);
  }

  return [...buckets.entries()].map(([groupValue, bucket]) => {
    const group: Record<string, string | number | null> = {
      [groupCol.key]: groupValue,
    };
    metrics.forEach((m, i) => {
      const { key, value } = computeMetric(bucket, columns, m, i);
      group[key] = value;
    });
    return group;
  });
}

function resolveGroupSortKey(
  groups: Array<Record<string, string | number | null>>,
  sortBy: string,
): string | undefined {
  const key = sortBy.trim();
  if (!key || groups.length === 0) return undefined;
  const sample = groups[0]!;
  if (key in sample) return key;
  const lower = key.toLowerCase();
  return Object.keys(sample).find((k) => k.toLowerCase() === lower);
}

/** Sort aggregate groups by a metric or group-column key (e.g. count, sum_qty). */
export function sortGroups(
  groups: Array<Record<string, string | number | null>>,
  sortBy: string | undefined,
  sortDir: 'asc' | 'desc' = 'asc',
): Array<Record<string, string | number | null>> {
  if (!sortBy?.trim() || groups.length === 0) return groups;
  const resolvedKey = resolveGroupSortKey(groups, sortBy);
  if (!resolvedKey) return groups;
  const dir = sortDir === 'desc' ? -1 : 1;
  return [...groups].sort((a, b) => {
    const av = a[resolvedKey];
    const bv = b[resolvedKey];
    const aEmpty = cellEmpty(av);
    const bEmpty = cellEmpty(bv);
    if (aEmpty && bEmpty) return 0;
    if (aEmpty) return -1 * dir;
    if (bEmpty) return 1 * dir;
    if (typeof av === 'number' && typeof bv === 'number') return dir * (av - bv);
    return dir * String(av).localeCompare(String(bv), 'zh-CN', { numeric: true });
  });
}

/**
 * Run the shared query pipeline:
 * rowKeys → query → filters → (row) sort → aggregate → (group) sort → offset/limit
 * or paginated rows (+ optional projection).
 */
export function runTableQuery(
  rows: readonly TableQueryRow[],
  columns: readonly TableQueryColumn[],
  options: TableQueryOptions = {},
): TableQueryResult {
  let working: TableQueryRow[] = rows.map((r) => ({ ...r }));

  if (options.rowKeys && options.rowKeys.length > 0) {
    const want = new Set(options.rowKeys.map(String));
    working = working.filter((r) => want.has(String(r.row_id ?? '')));
  }

  if (options.query?.trim()) {
    working = applyTextQuery(working, options.query);
  }

  working = applyColumnFilters(working, columns, options.filters);

  // Row-level sort only when sortBy resolves to a real column (not metric keys like "count").
  if (options.sortBy?.trim() && resolveTableQueryColumn(columns, options.sortBy)) {
    working = sortRows(working, columns, options.sortBy, options.sortDir ?? 'asc');
  }

  const matchedRows = working.length;
  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.max(1, options.limit ?? DEFAULT_TABLE_QUERY_LIMIT);

  if (options.aggregate && options.aggregate.metrics.length > 0) {
    let groups = aggregateRows(working, columns, options.aggregate);
    groups = sortGroups(groups, options.sortBy, options.sortDir ?? 'asc');
    const matchedGroups = groups.length;
    const page = groups.slice(offset, offset + limit);
    const hasMore = offset + page.length < matchedGroups;
    return {
      mode: 'aggregate',
      matchedRows,
      matchedGroups,
      offset,
      limit,
      hasMore,
      ...(options.aggregate.groupBy?.trim()
        ? {
            groupBy:
              resolveTableQueryColumn(columns, options.aggregate.groupBy)?.key ??
              options.aggregate.groupBy.trim(),
          }
        : {}),
      groups: page,
    };
  }

  const page = working.slice(offset, offset + limit);
  const projected = projectColumns(page, columns, options.columns);
  const hasMore = offset + projected.length < matchedRows;

  return {
    mode: 'rows',
    matchedRows,
    offset,
    limit,
    hasMore,
    rows: projected,
  };
}
