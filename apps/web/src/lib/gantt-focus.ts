/**
 * "定位到哪一条"。抽成纯函数是因为这条判定最容易出**沉默的错**:找不到时随便滚
 * 一个,看的人以为那就是他选的行。找不到就回 null,由调用方决定换窗口还是提示。
 */
export function resolveFocusTarget(
  tasks: Array<{ id: string; orderId?: string }>,
  want: { jobId?: string; orderId?: string },
): string | null {
  if (want.jobId) {
    const hit = tasks.find((t) => t.id === `job:${want.jobId}`);
    if (hit) return hit.id;
  }
  if (want.orderId) {
    const hit = tasks.find((t) => t.orderId === want.orderId);
    if (hit) return hit.id;
  }
  return null;
}

/**
 * 反方向:甘特点了一条,倒查它归属哪个订单(表格定位靠订单号,见
 * gantt-window-model.ts —— 只有二级 `job:` 那条 bar 自带 `orderId`,三级
 * `wo:` 子行没有)。点到三级子行时顺着 `parent` 链网上找,直到碰到一条自带
 * `orderId` 的祖先;泳道父行和查无此 id 都诚实回 undefined,不瞎猜。
 */
export function orderIdForTask(
  tasks: Array<{ id: string; parent?: string; orderId?: string }>,
  taskId: string,
): string | undefined {
  const byId = new Map(tasks.map((t) => [t.id, t] as const));
  let current = byId.get(taskId);
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    if (current.orderId) return current.orderId;
    seen.add(current.id);
    current = current.parent ? byId.get(current.parent) : undefined;
  }
  return undefined;
}
