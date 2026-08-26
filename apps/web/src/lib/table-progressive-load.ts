/**
 * 表格首屏不该等整表到齐。
 *
 * 排产大约三万行:一次 GET 整表 + 一次 JSON.parse + 一次灌进 AG-Grid,
 * 人要盯着转圈。分页每页 500,所以第一刀先取 500 画出来,其余后台续灌。
 * 定位若落在还没到的行上,要等续灌,不能立刻说"没有"。
 */

export const TABLE_GRID_FIRST_PAGE = 500;
export const TABLE_GRID_FILL_CHUNK = 2000;

/** 第一页已经在手上:还要不要继续拉。返回下一刀的 offset;齐了就 null。 */
export function tableFillOffset(
  loadedOnFirstPage: number,
  totalRows: number | undefined,
): number | null {
  const total = totalRows ?? loadedOnFirstPage;
  if (loadedOnFirstPage < total) return loadedOnFirstPage;
  return null;
}

/** 目标行还不在已加载的这段里,而且后面还有行在路上 → 接着等,别报找不到。 */
export function shouldWaitForMoreRows(loaded: number, total: number | null): boolean {
  return total != null && loaded < total;
}
