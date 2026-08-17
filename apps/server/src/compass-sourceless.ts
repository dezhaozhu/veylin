/**
 * 没挂数据源的项目 —— **只留发现类工具**。
 *
 * 实测踩到的真事:项目「111」的数据源那一栏写着"这个项目只用你自己的文件",
 * 而 agent 在里面回答了一整页 shangzhong 的排产数据。
 *
 * 机制是两边"各自没错"叠出来的:
 * - Veylin 这边:项目 sources 为空,仍然照常建 compass 连接,场景头是**空串**。
 * - Compass 那边:非 account 的旧式 token 本来就带着自己的租户claim,`bind_scene`
 *   对这类 token **直接忽略场景头**(这是它的既定行为,不是 bug)。
 *
 * 合起来:空头 → 落回 token 自己烘焙的租户 → 越过项目边界读到另一个厂的数据,
 * 而且界面上看起来完全正常。
 *
 * 为什么不干脆不连:那样"我有哪些数据源可以挂"这条路也断了 —— 新建的项目就没法
 * 上手。所以留下发现类(它按设计不碰任何场景数据),砍掉所有读数据的。
 */

/** Compass 侧 `SCENE_FREE_TOOLS` 的镜像:不绑场景就能调、也不碰场景数据的工具。 */
export const SCENE_FREE_TOOLS = ['list_my_scenes'] as const;

export function restrictSourcelessToolset<T extends Record<string, unknown>>(
  toolset: T,
  sources: readonly string[],
): Partial<T> {
  if (sources.length) return toolset;
  const out: Partial<T> = {};
  for (const name of SCENE_FREE_TOOLS) {
    if (name in toolset) out[name as keyof T] = toolset[name as keyof T];
  }
  return out;
}
