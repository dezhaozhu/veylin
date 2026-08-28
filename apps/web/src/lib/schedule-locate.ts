/**
 * 表格 ↔ 甘特的定位口。表格只发意图,不探测 dhtmlx、不 open 页签。
 * 没注册甘特能力时 locateGantt 是空操作 —— 没有甘特不能影响怎么用表格。
 *
 * hasGantt() 表示「画布能力在」(启动探测成功),不是「甘特页签此刻挂着」。
 * 页签没开就不跟选,仍由调用方(表格)自己守。
 */

export type ScheduleLocateTarget = {
  jobId?: string;
  orderId?: string;
  /** 开工日(YYYY-MM-DD)。甘特默认窗口对不上这一行时,用它把时间窗挪过来。 */
  fromDate?: string;
};

type LocateGanttImpl = (target: ScheduleLocateTarget) => void;
type LocateTableImpl = (target: ScheduleLocateTarget) => void;

let ganttRegistered = false;
let ganttImpl: LocateGanttImpl | null = null;
let tableImpl: LocateTableImpl = () => {};

export function registerGanttCapability(impl: { locateGantt: LocateGanttImpl }): void {
  ganttRegistered = true;
  ganttImpl = impl.locateGantt;
}

export function unregisterGanttCapability(): void {
  ganttRegistered = false;
  ganttImpl = null;
}

/** 能力已在时替换 locateGantt 实现(Provider 把 stash/open 接上来)。不改变 hasGantt。 */
export function setLocateGanttImpl(impl: LocateGanttImpl): void {
  ganttImpl = impl;
}

export function setLocateTableImpl(impl: LocateTableImpl): void {
  tableImpl = impl;
}

export function hasGantt(): boolean {
  return ganttRegistered;
}

export function locateGantt(target: ScheduleLocateTarget): void {
  if (!ganttRegistered) return;
  ganttImpl?.(target);
}

export function locateTable(target: ScheduleLocateTarget): void {
  tableImpl(target);
}

/** 表格→甘特只认作业号。勾选、看其它列、改资源都不是「去甘特看这一道」。 */
export function shouldLocateGanttFromTableClick(colId: string): boolean {
  return colId === 'job_id';
}

/** 作业号是定位手势,不能垫在最后一列滚出去。显示上紧跟订单号,不改库里的列顺序。 */
export function placeJobIdAfterOrderId<T extends { key: string }>(cols: readonly T[]): T[] {
  const job = cols.find((c) => c.key === 'job_id');
  if (!job) return [...cols];
  const rest = cols.filter((c) => c.key !== 'job_id');
  const orderIdx = rest.findIndex((c) => c.key === 'order_id');
  if (orderIdx === -1) return [job, ...rest];
  return [...rest.slice(0, orderIdx + 1), job, ...rest.slice(orderIdx + 1)];
}

/** 行上的开工日只取年月日。没有就不带,甘特仍走默认窗。 */
export function scheduleLocateFromDate(row: Record<string, unknown>): string | undefined {
  const raw = row['start'] ?? row['start_date'];
  if (raw == null || raw === '') return undefined;
  const match = String(raw).match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1];
}
