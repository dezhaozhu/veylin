/**
 * 场景认知卡的前端缓存。
 *
 * 规矩(用户定的):**默认吃缓存,打开时后台核对一次,变了才换,不定时轮询**;
 * 刷新留一个手动的。背景是两头都在重来 —— 服务端每次重算(shangzhong 2.7s,现已
 * 加前置键缓存降到 0.3s),前端"每次打开都重取"。
 *
 * 进程内、按项目分键。它是**加速**,不是真相来源:后台那次核对回来什么就是什么。
 */
export type CachedEntries = { entries: unknown[]; at: string };

const cache = new Map<string, CachedEntries>();

export function cacheKeyFor(
  hostUrl: string,
  specs: ReadonlyArray<{ resourceUri: string; argsKey: string; server: string }>,
): string {
  return JSON.stringify([
    hostUrl,
    specs.map((s) => [s.server, s.resourceUri, s.argsKey]).sort(),
  ]);
}

export function readSceneCardCache(key: string): CachedEntries | undefined {
  return cache.get(key);
}

export function writeSceneCardCache(key: string, entries: unknown[], at = new Date()): void {
  cache.set(key, { entries: [...entries], at: at.toISOString() });
}

export function clearSceneCardCache(): void {
  cache.clear();
}

/**
 * 后台核对回来之后,要不要用新的替换旧的。
 *
 * 两条:内容一样不换(免得白闪一下);**新结果全是失败时不覆盖已有的** —— 网络
 * 抖一下就把人眼前的卡清空,是拿"暂时取不到"冒充"没有"。本来就没有旧的时候,
 * 失败照常显示,那是真状态。
 */
export function entriesDiffer(prev: unknown[] | null, next: unknown[]): boolean {
  const allFailed = next.length > 0 &&
    next.every((e) => (e as { fetched?: { status?: string } })?.fetched?.status === 'error');
  if (prev && allFailed) return false;
  return JSON.stringify(prev) !== JSON.stringify(next);
}
