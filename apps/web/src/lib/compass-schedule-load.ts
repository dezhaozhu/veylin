/**
 * 表格面板该不该去 Compass 拉排产。
 *
 * 从前是**无条件拉**:`compassLoading` 初值就是 true,一挂载就 POST。于是在一个
 * 和 Compass 毫无关系的项目里(用户实测的「111」),右侧一打开就先闪一句
 * 「正在从 Compass 加载排产数据…」,接着弹一个「Compass 排产未加载」的错误提示 ——
 * 讲了一个根本不成立的故事,还把它说成出错。
 *
 * 服务端本身是按项目钉定的(没 compass 就诚实拒绝,不会串数据),所以问题全在
 * 客户端:**先知道有没有,再决定说什么**。
 */
import type { ProjectInfo } from '@/lib/projects-sync';

export type CompassLoadDecision = 'wait' | 'load' | 'skip';

export function decideCompassLoad(input: {
  threadId: string | undefined;
  /** null = 项目列表还没加载完。 */
  projects: ProjectInfo[] | null;
  /** null = thread→project 映射还没加载完。 */
  threadProjects: Record<string, string> | null;
}): CompassLoadDecision {
  // 两份缓存还没到齐就先等 —— 这时候判 skip 会把真该拉的项目也漏掉。
  if (input.projects === null || input.threadProjects === null) return 'wait';
  if (!input.threadId) return 'skip';

  const projectId = input.threadProjects[input.threadId];
  if (!projectId) return 'skip'; // 个人区:没钉项目就没有 Compass 可言。

  const project = input.projects.find((p) => p.id === projectId);
  if (!project) return 'skip'; // 钉的项目已删 / 列表没刷新 —— 不猜。

  return project.sources.length > 0 ? 'load' : 'skip';
}
