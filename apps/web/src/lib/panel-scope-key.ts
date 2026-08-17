/**
 * 表格面板"这一屏属于谁"的身份。
 *
 * 从前只认 threadId:换一条对话就重取。可**同一条对话是可以改钉到别的项目的**
 * (侧栏的移动菜单,以及输入框上新做的项目选择器)—— 那时 threadId 没变,面板
 * 却还摆着上一个项目的表:屏幕上是 A 的数据,而这轮对话已经归给了 B,在面板里
 * 的编辑也会落到 A 的表上。
 *
 * 所以身份是**(对话, 项目)这一对**,不是对话本身。
 */
export function panelScopeKey(
  threadId: string | undefined,
  projectId: string | null | undefined,
): string {
  return `${threadId ?? ''}::${projectId ?? ''}`;
}
