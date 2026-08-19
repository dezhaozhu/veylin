/**
 * 选区引用 —— 用户在表格里圈一块,@ 进对话。
 *
 * **存的是引用不是快照**:哪些行、哪些列、当时怎么分组筛选的。agent 拿着它去取
 * **当前值**(`table_get` 的 `selection_id`)。为什么不直接把数据塞进对话:三万行的表
 * 里选 200 行 × 20 列就是四千个值,既撑爆上下文,又把陈旧数据钉死在对话里 —— 五分钟
 * 后排产变了,那份还在,agent 会拿它当真。**与 G1 修的是同一个病。**
 *
 * 与变更日志的分工:**引用是拉(保证不陈旧),变更是推(保证不失忆)**。
 *
 * 同样刻意做成进程内、有上限:它是**本轮对话的指代**,不是需要长期保存的状态。
 */
import { randomBytes } from 'node:crypto';

export type TableSelection = {
  id: string;
  sheet: string;
  rowKeys: string[];
  columns: string[];
  groupBy: string[];
  filter: string;
  at: string;
};

/** 每个会话最多留这么多个选区(超出挤掉最老的)。 */
export const MAX_SELECTIONS_PER_THREAD = 20;

const store = new Map<string, Map<string, TableSelection>>();

export function registerSelection(input: {
  threadId: string;
  sheet: string;
  rowKeys: string[];
  columns: string[];
  groupBy?: string[];
  filter?: string;
}): TableSelection {
  if (input.rowKeys.length === 0 && input.columns.length === 0) {
    throw new Error('选区为空:没有可引用的行或列');
  }
  const sel: TableSelection = {
    id: randomBytes(4).toString('hex'),
    sheet: input.sheet,
    rowKeys: [...input.rowKeys],
    columns: [...input.columns],
    groupBy: [...(input.groupBy ?? [])],
    filter: input.filter ?? '',
    at: new Date().toISOString(),
  };
  const byThread = store.get(input.threadId) ?? new Map<string, TableSelection>();
  byThread.set(sel.id, sel);
  // 只留最新的若干个
  while (byThread.size > MAX_SELECTIONS_PER_THREAD) {
    const oldest = byThread.keys().next().value as string;
    byThread.delete(oldest);
  }
  store.set(input.threadId, byThread);
  return sel;
}

/**
 * agent 抄过来的 `selection_id` → 真正的 id。
 *
 * 人看到的 token 是 `@表格[p_x~schedule · 4 行 · 列: product_class #2d71be5a]`,id 前面
 * 就贴着表名。实测抄错过两种(都让用户看到假的"选区已过期"):`#2d71be5a`(连井号)、
 * `p_x~schedule#2d71be5a`(连表名)。**id 是最后一个 `#` 之后那截**,按这条剥,整条
 * token 抄过来也认。剥完仍是精确查表 —— 不做模糊匹配,认不出就认不出。
 */
export function normalizeSelectionId(id: string): string {
  const raw = String(id ?? '').trim();
  const afterHash = raw.slice(raw.lastIndexOf('#') + 1);
  // 整条 token 抄过来时尾巴上还挂着 `]`;id 本身只有十六进制。
  return afterHash.trim().replace(/[^A-Za-z0-9].*$/, '');
}

export function getSelection(threadId: string, id: string): TableSelection | undefined {
  // 按会话隔离:别的会话取不到 —— 与项目钉定同一条边界。
  return store.get(threadId)?.get(normalizeSelectionId(id));
}

/** 本会话现在还有哪些选区(最老在前)。查不到时用来说人话,而不是断言"已过期"。 */
export function listSelectionIds(threadId: string): string[] {
  return [...(store.get(threadId)?.keys() ?? [])];
}

export function clearSelections(): void {
  store.clear();
}

/** 插进输入框给人看的那一行:说清楚选了什么,**不带数据**。 */
export function formatSelectionToken(sel: TableSelection): string {
  const parts = [`${sel.sheet}`, `${sel.rowKeys.length} 行`];
  if (sel.columns.length) parts.push(`列: ${sel.columns.join('、')}`);
  if (sel.groupBy.length) parts.push(`按 ${sel.groupBy.join('/')} 分组`);
  if (sel.filter) parts.push(`筛选「${sel.filter}」`);
  return `@表格[${parts.join(' · ')} #${sel.id}]`;
}
