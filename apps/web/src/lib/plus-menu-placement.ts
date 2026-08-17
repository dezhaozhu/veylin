/**
 * 「+」菜单往哪边弹。
 *
 * 从前写死向上(`bottom: innerHeight - rect.top`)—— 聊天页输入框在底部,那是对的。
 * 项目页把同一个输入框搬到了**页面顶部**,菜单就顶出屏幕外:用户看到被切掉半截
 * 的一列。同一个组件换个位置就露馅,说明方向本来就不该写死。
 */
export type PlusMenuRect = { top: number; bottom: number; left: number; width: number };

export type PlusMenuPlacement = {
  left: number;
  width: number;
  /** 向上弹时用(距视口底部);向下弹时为 undefined。 */
  bottom?: number;
  /** 向下弹时用(距视口顶部);向上弹时为 undefined。 */
  top?: number;
  /** 不管往哪弹都给上限 —— 超出就在菜单内部滚,而不是被窗口切掉。 */
  maxHeight: number;
};

const GAP = 8;
/** 贴边留一点,别让菜单正好压在窗口边缘上。 */
const EDGE = 8;
const MIN_WIDTH = 240;

export function plusMenuPlacement(
  rect: PlusMenuRect,
  viewportHeight: number,
): PlusMenuPlacement {
  const spaceAbove = rect.top - GAP - EDGE;
  const spaceBelow = viewportHeight - rect.bottom - GAP - EDGE;
  const base = { left: rect.left, width: Math.max(MIN_WIDTH, rect.width) };

  // 空间大的那边赢:聊天页(底部输入框)照旧向上,项目页(顶部输入框)向下。
  if (spaceBelow > spaceAbove) {
    return { ...base, top: rect.bottom + GAP, maxHeight: Math.max(0, spaceBelow) };
  }
  return {
    ...base,
    bottom: viewportHeight - rect.top + GAP,
    maxHeight: Math.max(0, spaceAbove),
  };
}
