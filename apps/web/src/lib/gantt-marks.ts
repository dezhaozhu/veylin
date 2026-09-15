/**
 * 诚实标记 → CSS 类名。样式本体在 `index.css` 的甘特主题块里,这里只做映射,
 * 所以能单测。
 *
 * **为什么不再用 Tailwind 工具类**(2026-09-15 查配色时挖出):dhtmlx 的样式表
 * 是**无层**的(unlayered),而 Tailwind v4 的工具类全在 `@layer utilities` 里
 * —— 无层规则赢过任何 layer,跟源码先后顺序无关。`.gantt_task_line` 自己就设了
 * `background` 和 `border`,于是 `bg-*` / `border-*` 这类工具类落在条上一律不生效:
 * late(左侧琥珀竖条)、frozen(灰底)、overload(虚线框)这三种标记**从来没画
 * 出来过**,只有走 box-shadow 的 batch / maxlag 侥幸活着 —— 而那两个都是 1px 细
 * 内环,一蓝一红,挤在一屏里几乎认不出差别。五种标记看起来像两种。
 *
 * 现在样式写成 `.gantt_container .gantt_task_line.vg-*`(两个类 + 一个类 = 0,3,0),
 * 稳定压过库里的 `.gantt_task_line`(0,1,0),不需要 `!important`。改类名前先看
 * index.css 里那一段,两边是一对。
 */
export const GANTT_MARK_CLASSES: Record<string, string> = {
  late: 'vg-late',
  frozen: 'vg-frozen',
  batch: 'vg-batch',
  maxlag: 'vg-maxlag',
  overload: 'vg-overload',
};

/**
 * dhtmlx `templates.task_class(start, end, task)` 的实现体。
 *
 * 没有标记的条和泳道父行回空字符串 —— **不加任何装饰**。一屏几百条,"正常"必须
 * 是面板里最安静的东西,饱和度留给异常。
 */
export function ganttTaskClass(task: unknown): string {
  const marks = (task as { marks?: string[] } | undefined)?.marks ?? [];
  return marks
    .map((m) => GANTT_MARK_CLASSES[m])
    .filter(Boolean)
    .join(' ');
}
