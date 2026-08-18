/**
 * 「工具名 → ui:// 资源」映射:哪些工具带着要给人看的 widget。
 *
 * 两处要用同一份:渲染 widget 的 mcp-app-tool,以及决定"这条部件折不折"的
 * thread —— **带 widget 的工具部件不该被折进「Worked for」里**。甘特图、驾驶舱、
 * 场景卡是产物,不是"我干了些什么"的细节;折起来等于没有(用户实测:HTML 都取
 * 回来了,DOM 里却没有,因为那个块是 hidden 的)。
 */
import { useEffect, useState } from 'react';

import { appToolsCacheKey } from '@/lib/app-tools-key';

// toolName → ui:// resource map, fetched from the server (derived from each
// tool's _meta.ui.resourceUri). mastra doesn't forward that metadata onto the
// AI SDK tool-call part, so we look it up by tool name and inject it — generic
// across any tool/server that declares an MCP App UI, no hardcoding. Cached
// per threadId — different threads can have different project-pin-scoped
// tool sets, see routes/mcp-apps.ts's resolveScopedServerNames.
const appToolsPromiseByThread = new Map<string, Promise<Record<string, string>>>();
function loadAppTools(
  threadId: string | undefined,
  projectId: string | undefined,
): Promise<Record<string, string>> {
  // 键里带上钉定:映射取决于线程钉在哪个项目,而项目页是"先建线程、后钉项目",
  // 中间那一刻问到的必然是空表(实测:widget 全体不渲染,而且再也不会自己好)。
  const key = appToolsCacheKey(threadId, projectId);
  let promise = appToolsPromiseByThread.get(key);
  if (!promise) {
    const url = threadId ? `/api/mcp-apps/tools?threadId=${encodeURIComponent(threadId)}` : '/api/mcp-apps/tools';
    promise = fetch(url)
      .then((r) => (r.ok ? r.json() : { tools: {} }))
      .then((d: { tools?: Record<string, string> }) => d.tools ?? {})
      .catch(() => ({}));
    // **空表不留缓存。** 第一帧还没有 threadId 时问到的是个人区,答案必然是空;
    // 把它永久缓存住,这条线程后面再也不会去问第二次。
    void promise.then((m) => {
      if (Object.keys(m).length === 0) appToolsPromiseByThread.delete(key);
    });
    appToolsPromiseByThread.set(key, promise);
  }
  return promise;
}

export function useAppTools(
  threadId: string | undefined,
  projectId: string | undefined,
): Record<string, string> {
  const [map, setMap] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    loadAppTools(threadId, projectId).then((m) => {
      if (alive) setMap(m);
    });
    return () => {
      alive = false;
    };
  }, [threadId, projectId]);
  return map;
}
