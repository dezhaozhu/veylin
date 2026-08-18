/**
 * MCP App 的「工具 → ui:// 资源」映射,缓存该按什么键存。
 *
 * 只按 threadId 存不够:这个映射取决于**这条线程钉在哪个项目**(服务端按项目
 * 作用域决定连不连 Compass)。而项目页是"先建线程、后钉项目",于是有一个窗口,
 * 线程 id 已经有了、钉定还没落地 —— 那一刻问到的映射必然是空的。
 *
 * 实测后果:widget 一个都不渲染,而且**再也不会自己好**(effect 只跟 threadId
 * 变,钉定落地不触发重取)。把钉定并进键里,钉定一变就会重取。
 */
export function appToolsCacheKey(
  threadId: string | undefined,
  projectId: string | undefined,
): string {
  return `${threadId ?? ''}|${projectId ?? ''}`;
}
