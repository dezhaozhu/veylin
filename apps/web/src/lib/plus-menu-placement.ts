/**
 * 「+」菜单往哪边弹。
 *
 * 从前写死向上(`bottom: innerHeight - rect.top`)—— 聊天页输入框在底部,那是对的。
 * 项目页把同一个输入框搬到了**页面顶部**,菜单就顶出屏幕外:用户看到被切掉半截
 * 的一列。同一个组件换个位置就露馅,说明方向本来就不该写死。
 *
 * **只管方向,不做裁剪。** 第一版顺手加了 maxHeight + overflow-y,结果更糟:
 * CSS 里一轴非 visible 会把另一轴一并强制成 auto,而面板固定 280px 宽、外层定位
 * 容器只有按钮那么宽 —— 面板当场被横向切掉,「技能 / MCP」向右飞出的子菜单也会
 * 一起没。菜单本来就只有几行,装不下不是真问题;裁才是。
 */
export type PlusMenuRect = { top: number; bottom: number; left: number; width: number };

export type PlusMenuPlacement = {
  left: number;
  width: number;
  /** 向上弹时用(距视口底部);向下弹时为 undefined。 */
  bottom?: number;
  /** 向下弹时用(距视口顶部);向上弹时为 undefined。 */
  top?: number;
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
    return { ...base, top: rect.bottom + GAP };
  }
  return { ...base, bottom: viewportHeight - rect.top + GAP };
}
