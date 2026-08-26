/**
 * "定位到哪一条"。抽成纯函数是因为这条判定最容易出**沉默的错**:找不到时随便滚
 * 一个,看的人以为那就是他选的行。找不到就回 null,由调用方决定换窗口还是提示。
 */
export function resolveFocusTarget(
  tasks: Array<{ id: string; orderId?: string }>,
  want: { jobId?: string; orderId?: string },
): string | null {
  // 点了具体作业就只认这一条。当前窗口没有时回 null,让调用方换窗口;
  // 不准拿同一订单的另一道工序凑数(同单下 QY / CJ1 是两道活)。
  if (want.jobId) {
    const hit = tasks.find((t) => t.id === `job:${want.jobId}`);
    return hit ? hit.id : null;
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

/**
 * 反方向:甘特点了一条,倒查它是哪道作业。二级条 id 是 `job:${job_id}`;
 * 三级 `wo:` 子行没有自己的作业号,顺着 parent 链找到二级条。泳道父行和
 * 查无此 id 都诚实回 undefined —— 表格对行靠这个,猜错就会落到同单另一道。
 */
export function jobIdForTask(
  tasks: Array<{ id: string; parent?: string }>,
  taskId: string,
): string | undefined {
  const byId = new Map(tasks.map((t) => [t.id, t] as const));
  let current = byId.get(taskId);
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    if (current.id.startsWith('job:')) return current.id.slice('job:'.length);
    seen.add(current.id);
    current = current.parent ? byId.get(current.parent) : undefined;
  }
  return undefined;
}

/**
 * 这次点击是不是点在树的**展开/收起图标**上?
 *
 * 真机实证(2026-08-25):点展开箭头会同时触发 dhtmlx 的 `onTaskOpened`(展开取三级)
 * 和 `onTaskClick`(点行跳表格)。两个功能各自都对,但跳转会把整个甘特面板卸载
 * (右侧面板只挂载当前页签),于是展开永远渲染不出来 —— 用户看到的是"点箭头没反应,
 * 还莫名其妙跳去了表格"。所以跳转要给展开让路。
 *
 * 判定沿 DOM 往上找(`closest`):图标里可能还有子元素,点在子元素上也该算。
 * 拿不到事件目标时**回 false** —— 宁可照常跳转,也不要静默吞掉一次点击。
 */
export function isTreeToggleTarget(target: unknown): boolean {
  const el = target as { closest?: (sel: string) => unknown } | null | undefined;
  return Boolean(el?.closest?.('.gantt_tree_icon'));
}
