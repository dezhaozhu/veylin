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
