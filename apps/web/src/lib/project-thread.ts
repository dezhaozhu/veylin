/**
 * 从项目页离开时,**该落回哪条对话**。
 *
 * 项目页占满中间,点「在右侧打开」要给右侧面板让位,于是项目页关掉 —— 底下露出来
 * 的是你**上次**看的那条对话,它可能属于另一个项目(实测:在「上重」点开一份快照,
 * 人落在了「caliper-测试」里,而右边显示的是上重的文件)。面板内容和对话上下文
 * 各说各的,下一句话就发错项目了。
 *
 * 所以离开前先落到本项目**最近说过话的**那条;一条都没有就返回 null,由调用方
 * 新开一条并钉上(不能凭空把人留在别人的对话里)。
 */
export type ThreadRef = {
  id: string;
  remoteId?: string | undefined;
  externalId?: string | undefined;
  lastMessageAt?: Date | undefined;
};

/**
 * 三重回退,和侧栏分组用的是同一把钥匙:全新的空线程在第一条消息之前没有
 * remoteId,而那个本地 id 之后会**变成** remoteId —— 钉项目时用的正是它。
 */
export const threadKey = (t: ThreadRef): string => t.remoteId ?? t.externalId ?? t.id;

export function pickProjectThread(
  threads: readonly ThreadRef[],
  threadProjects: Record<string, string>,
  projectId: string,
): string | null {
  const mine = threads.filter((t) => threadProjects[threadKey(t)] === projectId);
  if (mine.length === 0) return null;
  // 没有 lastMessageAt 的是还没说过话的新线程,排最后 —— 落回一条空对话
  // 等于什么上下文也没接上。
  const time = (t: ThreadRef) => t.lastMessageAt?.getTime() ?? 0;
  return mine.reduce((best, t) => (time(t) > time(best) ? t : best)).id;
}
