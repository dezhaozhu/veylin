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
