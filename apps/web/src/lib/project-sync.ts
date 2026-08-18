/** Client project-pin (grouped MCP server scope) cache + API sync — mirrors plan-mode-sync.ts. */

export async function fetchThreadProject(threadId: string): Promise<string | null> {
  const res = await fetch(`/api/project?threadId=${encodeURIComponent(threadId)}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { project?: string | null };
  return data.project ?? null;
}

export async function postThreadProject(threadId: string, project: string): Promise<string | null> {
  const res = await fetch('/api/project', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ threadId, project }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { ok?: boolean; project?: string | null };
  return data.project ?? null;
}

const projectByThread = new Map<string, string | null>();

/**
 * 每条线程被写过几次。
 *
 * 项目页的钉定是**异步落在一条刚切过去的线程上**的,而输入框在切过去那一刻就已经
 * 问了一次"这条钉在哪" —— 那时还没钉,答 null。等钉定落地,如果没人通知,界面就
 * 一直停在"没有项目"(用户实测:在上重项目页说话,变成了个人对话,而服务端其实
 * 钉对了);更阴的是那个**先发后到**的查询还会把已经钉好的值盖回 null。
 *
 * 所以:写入要通知,查询要能判断"我在飞的时候有没有人写过我这条"。戳记按线程记,
 * 不用全局计数 —— 别的线程写入不该让我丢掉自己的结果。
 */
const stampByThread = new Map<string, number>();
const listeners = new Set<() => void>();

/** `undefined` = never fetched for this thread; `null` = fetched, confirmed unpinned. */
export function readCachedThreadProject(threadId: string | undefined): string | null | undefined {
  if (!threadId) return undefined;
  return projectByThread.get(threadId);
}

export function writeCachedThreadProject(threadId: string, project: string | null): void {
  projectByThread.set(threadId, project);
  stampByThread.set(threadId, (stampByThread.get(threadId) ?? 0) + 1);
  for (const listener of listeners) listener();
}

/** 查询发出前取一次,拿回结果时再取一次:不相等 = 这中间有人写过,别盖。 */
export function threadProjectStamp(threadId: string): number {
  return stampByThread.get(threadId) ?? 0;
}

export function subscribeThreadProject(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
