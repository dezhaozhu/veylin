/**
 * "导入完成后,请把表格面板切到这张表"。
 *
 * 预览里点「导入到表格面板」之后,只把面板打开是不够的:新表在一堆页签里,
 * 人还得自己找(它甚至可能不是当前表)。导入方把名字放在这儿,表格面板刷新
 * 页签时取走并切过去 —— 和图表那条路(pendingChart)是同一个套路。
 */
let pending: string | null = null;

export function requestSheetSelection(name: string): void {
  pending = name;
}

/** 取走(只生效一次)—— 留着的话下一次刷新页签又会把人拽走。 */
export function consumeSheetSelection(): string | null {
  const v = pending;
  pending = null;
  return v;
}
