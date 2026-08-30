/**
 * 拖页签分屏的**落点判定**。抽成纯函数的理由和 gantt-focus 的一样:这条判定
 * 一旦错,错得很安静 —— 松手落到另一个 pane、或者明明不会有变化却亮了预览,
 * 用户只会觉得"这东西很飘"。
 *
 * 原则:**不会改变任何东西的位置不给落点**(不亮预览、松手什么也不做)。
 * VS Code 会给当前组也画预览,但那是因为它还能改组内顺序;我们 v1 不排序,
 * 亮一块"松手也没事发生"的高亮是在撒谎。
 */

/** 小于这个位移算点击,不算拖动 —— 否则点页签切换会变成一次微型拖拽。 */
export const DRAG_THRESHOLD_PX = 4;

export function exceedsDragThreshold(dx: number, dy: number): boolean {
  return Math.abs(dx) >= DRAG_THRESHOLD_PX || Math.abs(dy) >= DRAG_THRESHOLD_PX;
}

export type DropTarget = {
  pane: 'top' | 'bottom';
  /** 松手会不会**新建**分屏(而不是在已有的两个 pane 之间搬)。 */
  creates: boolean;
  /** 预览高亮的纵向区间,占内容区高度的比例。 */
  band: { start: number; end: number };
};

export function resolveDropTarget(args: {
  /** 指针的视口 Y 坐标。 */
  pointerY: number;
  /** 内容区(两个 pane 加起来那块)的视口矩形。 */
  rect: { top: number; height: number };
  /** 当前分屏比例;未分屏传 null。 */
  splitRatio: number | null;
  /** 被拖的页签现在在哪个 pane。 */
  from: 'top' | 'bottom';
  /** 上 pane 现有页签数 —— 只剩一个就不许往下搬(会掏空上 pane)。 */
  topTabCount: number;
}): DropTarget | null {
  const { pointerY, rect, splitRatio, from, topTabCount } = args;
  if (rect.height <= 0) return null;
  const offset = pointerY - rect.top;
  // 指针跑出内容区(拖到聊天区、拖出窗口)不给落点。
  if (offset < 0 || offset > rect.height) return null;

  const boundary = splitRatio ?? 0.5;
  const pane: 'top' | 'bottom' = offset < boundary * rect.height ? 'top' : 'bottom';

  // 落回自己所在的 pane:未分屏时"上"就是原地,已分屏时同理 —— 都不会有变化。
  if (pane === from) return null;
  // 上 pane 不许被掏空(和 moveTabToPane 的守卫同一条规则)。
  if (pane === 'bottom' && topTabCount <= 1) return null;

  const creates = splitRatio == null;
  return {
    pane,
    creates,
    band: pane === 'top' ? { start: 0, end: boundary } : { start: boundary, end: 1 },
  };
}
