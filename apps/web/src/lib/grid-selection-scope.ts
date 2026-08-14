/**
 * 「引用什么」的判定 —— 从网格当前的几种选中状态里，挑出该被引用的那一块。
 *
 * 手势的语义分得开:
 *   框选一片   → 引用这一片(行 × 列)
 *   点一个格子 → **不是引用**。点格子多半是要改它,这时冒出个引用按钮是碍事。
 *   勾选整行   → 引用整行(所有列),不因为刚点过某个格子就缩成一列。
 *   点列头     → 引用整列。
 */
export type SelectionScope = { rowKeys: string[]; columns: string[] };

export function resolveSelectionScope(input: {
  /** AG-Grid 当前的单元格区域展开成的行/列 */
  range: SelectionScope;
  /** 勾选的整行 */
  checkedRowKeys: string[];
  /** 选中的整列(点列头) */
  selectedColumnKey?: string | null;
}): SelectionScope | null {
  const { range, checkedRowKeys, selectedColumnKey } = input;
  const cells = range.rowKeys.length * range.columns.length;
  if (cells > 1) return { rowKeys: [...range.rowKeys], columns: [...range.columns] };
  if (checkedRowKeys.length) return { rowKeys: [...checkedRowKeys], columns: [] };
  if (selectedColumnKey) return { rowKeys: [], columns: [selectedColumnKey] };
  return null;
}

/**
 * 那个浮现的「@ 引用到对话」该不该出现。
 *
 * 监听挂在 document 上(拖选的抬手可能落在网格外),所以必须自己判断这一下点在
 * 哪儿 —— 否则点应用里任何地方都会冒出来一个引用按钮(实测撞到过:侧栏空白处
 * 一点,气泡就飘在那儿)。
 *
 * `keep` 是为气泡自己留的:点在气泡上时什么都别做。mouseup 早于 click,这时
 * 把它收掉,按钮还没来得及被点到就没了。
 */
export function askBubbleAction(input: {
  insideGrid: boolean;
  insideBubble: boolean;
  scope: SelectionScope | null;
}): 'show' | 'hide' | 'keep' {
  if (input.insideBubble) return 'keep';
  if (!input.insideGrid) return 'hide';
  return input.scope ? 'show' : 'hide';
}
