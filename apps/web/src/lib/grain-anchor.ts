/**
 * 焦段之间的锚点。
 *
 * 订单 / 工序 / 派工 是同一个模型的三个焦段,不是三张互不相干的表。切焦段时把
 * "我刚才在看的那一单"带过去,切换才是**变焦**,而不是**跳表后重新找位置**。
 *
 * 身份怎么对上:二级(订单、工序)行带 `order_id`;三级(派工)行只有 `wbs`。而 Compass
 * 里一张订单的 `order_id` 本身可能就是逗号拼起来的多个 WBS —— 所以两层的匹配是
 * "WBS 集合相交",不是字符串相等。
 */

const split = (v: string) =>
  v
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

/** 这一行属于哪一单。认不出来返回 null —— 不猜。 */
export function anchorOfRow(row: Record<string, unknown> | undefined | null): string | null {
  if (!row) return null;
  const oid = row['order_id'];
  if (typeof oid === 'string' && oid.trim()) return oid.trim();
  const wbs = row['wbs'];
  if (typeof wbs === 'string' && wbs.trim()) return wbs.trim();
  return null;
}

/** 换焦段之后,这一行是不是"同一单"。 */
export function rowMatchesAnchor(
  row: Record<string, unknown> | undefined | null,
  anchor: string | null | undefined,
): boolean {
  if (!row || !anchor || !anchor.trim()) return false;
  const rowKey = anchorOfRow(row);
  if (!rowKey) return false;
  const a = new Set(split(anchor));
  return split(rowKey).some((p) => a.has(p));
}

export type LocateTarget = {
  jobId?: string;
  orderId?: string;
};

/**
 * 甘特→表格对哪一行。给了 jobId 就只认这一道作业,不准拿同单另一道凑数。
 * 只给订单号时退回焦段锚点(订单 / WBS 相交)。
 */
export function rowMatchesLocateTarget(
  row: Record<string, unknown> | undefined | null,
  target: LocateTarget,
): boolean {
  if (target.jobId) {
    if (!row) return false;
    const jid = row['job_id'];
    return jid != null && String(jid).trim() === target.jobId.trim();
  }
  return rowMatchesAnchor(row, target.orderId);
}

export type LocatePick<T> = {
  status: 'hit' | 'wait' | 'miss';
  rows: T[];
};

/**
 * 在当前已加载的行里挑定位目标。
 * 作业号优先;续灌没到就等;全部到齐仍没有这道作业,才退回该单第一行。
 */
export function pickLocateRows<T extends Record<string, unknown>>(
  rows: T[],
  target: LocateTarget,
  opts: { hasMore: boolean },
): LocatePick<T> {
  if (target.jobId) {
    const exact = rows.filter((r) => rowMatchesLocateTarget(r, { jobId: target.jobId }));
    if (exact.length) return { status: 'hit', rows: exact };
    if (opts.hasMore) return { status: 'wait', rows: [] };
    if (target.orderId) {
      const fallback = rows.filter((r) => rowMatchesAnchor(r, target.orderId));
      if (fallback.length) return { status: 'hit', rows: fallback };
    }
    return { status: 'miss', rows: [] };
  }
  if (target.orderId) {
    const hits = rows.filter((r) => rowMatchesAnchor(r, target.orderId));
    if (hits.length) return { status: 'hit', rows: hits };
    if (opts.hasMore) return { status: 'wait', rows: [] };
    return { status: 'miss', rows: [] };
  }
  return { status: 'miss', rows: [] };
}
