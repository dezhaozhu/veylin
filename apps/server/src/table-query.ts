/**
 * 查一张表,而不是翻它。
 *
 * 导入的表此前只有 `table_get(offset, limit≤200)` —— 四万九千行要翻 247 次,
 * 等于读不了。Compass 自己的数据早有筛选口径(`get_schedule_rows(workshop=…)`),
 * 用户导进来的表却没有;这里补上,并且**口径照 Compass 那边**:
 *
 *  - `matched` 是筛完、切页前的真数(不是这次给了几行);
 *  - **列名写错就拒绝**并列出可用列 —— 静默忽略一个条件,会把"没筛到"讲成"没有",
 *    那是最贵的一种错;
 *  - 分组计数是认识一张陌生表的入口:先问"这列都有哪些值、各多少行",再问问题。
 *
 * 纯函数,不碰 store —— 好测,也方便将来换成真正的列式查询。
 */
export type QueryOp = 'eq' | 'contains' | 'gt' | 'lt' | 'empty' | 'nonempty';
export type QueryFilter = { column: string; op: QueryOp; value?: string };

export type QueryInput = {
  filters?: QueryFilter[];
  groupBy?: string;
  /** 分组最多给几组(其余靠 groupsTotal 说明);默认 50 */
  groupLimit?: number;
  /** 只要这些列(省 token);不给就是全部 */
  columns?: string[];
  limit?: number;
  offset?: number;
};

export type QueryResult = {
  matched: number;
  returned: number;
  rows: Array<Record<string, unknown>>;
  groups?: Array<{ value: string; count: number }>;
  groupsTotal?: number;
  refused?: true;
  unknownColumns?: string[];
  message?: string;
};

const DEFAULT_LIMIT = 50;
const DEFAULT_GROUP_LIMIT = 50;

const cell = (row: Record<string, unknown>, col: string): string =>
  String(row[col] ?? '').trim();

function passes(row: Record<string, unknown>, f: QueryFilter): boolean {
  const v = cell(row, f.column);
  const want = String(f.value ?? '').trim();
  switch (f.op) {
    case 'eq':
      return v === want;
    case 'contains':
      return v.includes(want);
    case 'empty':
      return v === '';
    case 'nonempty':
      return v !== '';
    case 'gt':
    case 'lt': {
      // 能当数就当数比 —— 否则 "5" > "30" 这种字符串比较会给出荒谬答案
      const a = Number(v);
      const b = Number(want);
      if (Number.isFinite(a) && Number.isFinite(b)) return f.op === 'gt' ? a > b : a < b;
      return f.op === 'gt' ? v > want : v < want;
    }
    default:
      return true;
  }
}

export function queryTableRows(
  rows: Array<Record<string, unknown>>,
  columns: string[],
  input: QueryInput = {},
): QueryResult {
  const known = new Set(columns);
  const asked = [
    ...(input.filters ?? []).map((f) => f.column),
    ...(input.groupBy ? [input.groupBy] : []),
    ...(input.columns ?? []),
  ];
  const unknown = [...new Set(asked.filter((c) => !known.has(c)))];
  if (unknown.length) {
    return {
      matched: 0,
      returned: 0,
      rows: [],
      refused: true,
      unknownColumns: unknown,
      message: `这张表没有这些列: ${unknown.join('、')}。可用列: ${columns.join('、')}`,
    };
  }

  const filters = input.filters ?? [];
  const hit = filters.length ? rows.filter((r) => filters.every((f) => passes(r, f))) : rows;

  const out: QueryResult = { matched: hit.length, returned: 0, rows: [] };

  if (input.groupBy) {
    const counts = new Map<string, number>();
    for (const r of hit) {
      const key = cell(r, input.groupBy);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const all = [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      // 数量降序;同数按值排,免得同一份数据两次调用给出不同顺序
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    out.groupsTotal = all.length;
    out.groups = all.slice(0, Math.max(1, input.groupLimit ?? DEFAULT_GROUP_LIMIT));
  }

  const limit = input.limit ?? DEFAULT_LIMIT;
  if (limit > 0) {
    const offset = Math.max(0, input.offset ?? 0);
    const page = hit.slice(offset, offset + limit);
    const wanted = input.columns?.length ? input.columns : null;
    out.rows = wanted
      ? page.map((r) => Object.fromEntries(wanted.map((c) => [c, r[c]])))
      : page.map((r) => ({ ...r }));
    out.returned = out.rows.length;
  }
  return out;
}
