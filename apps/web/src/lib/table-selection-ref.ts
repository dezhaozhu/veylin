/**
 * 表格选区 → 对话引用。
 *
 * **引用不是快照**:登记的是"哪些行、哪些列、当时怎么分组筛选的",不是那一刻的值。
 * agent 拿着 id 去 `table_get(selection_id=…)` 取**当前值** —— 三万行的表里选 200 行
 * 把数据塞进对话,既撑爆上下文,又把陈旧数据钉死在里面(五分钟后排产变了,那份还在)。
 *
 * 与 `thread-selection-ask`(选中文字→提问)同形:登记 → 拿短串 → 插进输入框。
 */
export type TableSelectionInput = {
  sheet: string;
  threadId: string;
  rowKeys: string[];
  columns: string[];
  groupBy?: string[];
  filter?: string;
};

export async function registerTableSelection(
  input: TableSelectionInput,
): Promise<{ ok: true; token: string } | { ok: false; message: string }> {
  const res = await fetch('/api/table/selection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as { ok?: boolean; token?: string; message?: string };
  if (!res.ok || !data.ok || !data.token) {
    return { ok: false, message: data.message ?? 'selection failed' };
  }
  return { ok: true, token: data.token };
}

/** 追加到输入框已有内容之后(不覆盖用户已经写的字)。 */
export function appendSelectionToken(current: string, token: string): string {
  return current.trim() ? `${current.trimEnd()}\n\n${token} ` : `${token} `;
}
