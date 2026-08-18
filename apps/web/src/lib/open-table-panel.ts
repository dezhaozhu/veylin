/**
 * 点开右侧「表格」面板时,该看哪张表。
 *
 * **打开 ≠ 新建。** 从前这两件事走同一条路(都调 createNextThreadSheet),于是每点
 * 一次面板就多一张空 Sheet;而表是按项目存的,新开一个对话再点一下,项目里就又多
 * 一张 —— 用户看到的是 Sheet 1…Sheet 6 一路堆上去,没人知道那些是谁建的。
 *
 * 新建只留给面板里那个「+」。
 */
import type { TableSheetMeta } from './table-sheets';

export type TablePanelSheet = { kind: 'open'; sheetId: string } | { kind: 'create' };

export function decideTablePanelSheet(existing: TableSheetMeta[]): TablePanelSheet {
  const first = existing[0];
  // 一张都没有时才建:空面板连一张可看的表都没有,那才是真的没东西可打开。
  return first ? { kind: 'open', sheetId: first.id } : { kind: 'create' };
}
