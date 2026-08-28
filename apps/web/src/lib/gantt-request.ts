/**
 * Two small pure judgments pulled out of gantt-panel.tsx so they're covered by
 * a test instead of a one-time manual walkthrough — evaluation flagged both as
 * "取错会造成最难查的现象" spots:
 *
 *  - threadId derivation: get this wrong and the symptom is silent ("表格看得见,
 *    甘特看不见"), not a crash — nothing points you back here.
 *  - server error message passthrough: get this wrong and a specific, honest
 *    409/502 reason quietly turns into a generic "加载失败", and nobody notices
 *    because the panel still renders *something*.
 */

export type GanttThreadListItem = {
  id?: string | null;
  remoteId?: string | null;
  externalId?: string | null;
};

/**
 * Same remoteId-first fallback used elsewhere in this repo (table-grid.tsx,
 * mcp-app-tool.tsx): the local composer id is all a brand-new thread has;
 * once the thread's first message round-trips the server, it gets a
 * remoteId/externalId, and THAT is what the server-side scope resolver
 * (resolveCompassRequestScope) actually keys off. Getting the precedence
 * wrong doesn't error — it just silently resolves to the wrong (or no)
 * project pin.
 */
export function resolveGanttThreadId(item: GanttThreadListItem): string | undefined {
  return item.remoteId ?? item.externalId ?? item.id ?? undefined;
}

/**
 * Given the parsed JSON body of a non-ok `/api/gantt/window` response, pick
 * the text to show. The server's `message` is human-authored (the 409 "没钉
 * 项目" copy, or a 502 Compass error) and must survive verbatim to the user —
 * this must never quietly collapse into a generic fallback just because it's
 * convenient to have one string to render.
 */
export function ganttErrorMessage(
  body: { message?: unknown } | null | undefined,
  fallback: string,
): string {
  const msg = body?.message;
  return typeof msg === 'string' && msg.length > 0 ? msg : fallback;
}

export type GanttView = 'resource' | 'workshop' | 'order';

/**
 * 面板取数的 URL。从 gantt-panel.tsx 搬过来,因为 `expand` 让它有了真正的判断
 * (空列表不该带参数),而判断就该有测试。
 */
export function ganttWindowUrl(
  threadId: string | undefined,
  view: GanttView,
  expand: readonly string[] = [],
  opts?: { fromDate?: string; laneLimit?: number },
): string {
  const q = new URLSearchParams({ view });
  if (threadId) q.set('threadId', threadId);
  // 空列表**不带这个参数** —— 否则服务端会为一个空的展开清单白跑一遍三级查询。
  if (expand.length > 0) q.set('expand', expand.join(','));
  if (opts?.fromDate) q.set('from_date', opts.fromDate);
  if (opts?.laneLimit != null && opts.laneLimit > 0) q.set('lane_limit', String(opts.laneLimit));
  return `/api/gantt/window?${q}`;
}

/**
 * 把一个订单加进"已展开"集合;**已经在里面就回 `null`**,让调用方直接跳过重拉。
 *
 * 为什么回 null 而不是回原数组:回原数组的话调用方要自己做引用比较才知道该不该
 * 发请求,而"忘了比较"的后果是每次展开都重拉一次窗口 —— 30k 行的厂里,那是几百毫秒
 * 白烧 + 树被数据刷新打断。让"没变化"变成一个显式的值,调用方就漏不掉。
 */
export function withExpanded(
  current: readonly string[],
  orderId: string | undefined,
): string[] | null {
  if (!orderId) return null;
  if (current.includes(orderId)) return null;
  return [...current, orderId];
}
