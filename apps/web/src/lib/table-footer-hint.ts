/**
 * 表格底栏提示。总数已经在翻页「1 to N of M」里,不再单独画「合计」。
 * 只在灌数未齐或有勾选时占翻页行左边。
 */
export type TableFooterHint =
  | { kind: 'loading'; loaded: number; total: number }
  | { kind: 'selected'; count: number }
  | { kind: 'none' };

export function tableFooterHint(totals: {
  selectedCount: number;
  loadedCount?: number;
  expectedCount?: number | null;
}): TableFooterHint {
  if (
    totals.expectedCount != null &&
    totals.loadedCount != null &&
    totals.loadedCount < totals.expectedCount
  ) {
    return { kind: 'loading', loaded: totals.loadedCount, total: totals.expectedCount };
  }
  if (totals.selectedCount > 0) {
    return { kind: 'selected', count: totals.selectedCount };
  }
  return { kind: 'none' };
}
