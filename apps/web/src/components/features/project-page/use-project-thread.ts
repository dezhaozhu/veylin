/**
 * 从项目页进到对话时,**保证脚下这条对话属于这个项目**。
 *
 * 两个入口都需要它,原来只有输入框那个有:
 *  - 输入框:你要说话了,开一条新的钉上(`reuse: false` —— 在项目页打字就是开新对话);
 *  - 上下文卡片「在右侧打开」:项目页要给右侧面板让位而关掉,底下露出来的却是你
 *    上次看的那条对话,可能属于别的项目(实测:在「上重」点开快照,人落到了
 *    「caliper-测试」)。这里优先落回本项目最近那条,没有才新开。
 *
 * 钉定必须在**第一条消息之前**完成:强制 initialize() 拿到真 threadId 再钉,
 * 否则第一句话会落进一个还没归属的线程 —— 而"它属于哪个项目"是整套上下文的前提。
 */
import { useCallback } from 'react';
import { useAui, useAuiState } from '@assistant-ui/react';

import { postThreadProject, writeCachedThreadProject } from '@/lib/project-sync';
import {
  invalidateThreadProjects,
  removeThreadProjectPin,
  upsertThreadProjectPin,
  useThreadProjects,
} from '@/lib/thread-projects-sync';
import { pickProjectThread, type ThreadRef } from '@/lib/project-thread';

export function useEnterProjectThread(): (
  projectId: string,
  opts?: { reuse?: boolean },
) => Promise<void> {
  const aui = useAui();
  const threadProjects = useThreadProjects();
  const threadIds = useAuiState((s) => s.threads.threadIds);
  const threadItems = useAuiState((s) => s.threads.threadItems);

  return useCallback(
    async (projectId, opts) => {
      if (opts?.reuse !== false) {
        const refs: ThreadRef[] = threadIds.map(
          (id) => (threadItems.find((t) => t.id === id) as ThreadRef | undefined) ?? { id },
        );
        const found = pickProjectThread(refs, threadProjects, projectId);
        if (found) {
          await aui.threads().switchToThread(found);
          return;
        }
      }
      await aui.threads().switchToNewThread();
      // **不能用 `item('main')`。** 它读的是 React 那份快照,`switchToNewThread()`
      // 之后可能还指着**上一条**线程 —— 钉子于是钉在上一条上,你正在说话的这条
      // 反而没归属,界面表现就是"在项目页说话却变成了个人对话"(用户实测;
      // e2e 对账抓到 chip 在 A 线程、钉定落在 B 线程)。侧栏的「在项目里新开
      // 对话」早就绕开了这个坑,这里用同一套:读活的 runtime。
      const threadsRt = aui.threads().__internal_getAssistantRuntime?.().threads;
      if (!threadsRt) throw new Error('assistant runtime threads unavailable');
      const mainId = threadsRt.getState().mainThreadId;
      // 先乐观钉上:钉定是异步的,而人可能马上就打字。失败再撤。
      const optimistic: string[] = [mainId];
      upsertThreadProjectPin(mainId, projectId);
      try {
        const initialized = await threadsRt.mainItem.initialize();
        const rid = initialized.remoteId ?? initialized.externalId ?? mainId;
        if (rid !== mainId) {
          upsertThreadProjectPin(rid, projectId);
          optimistic.push(rid);
        }
        const confirmed = await postThreadProject(rid, projectId);
        if (confirmed == null) throw new Error('钉定没被接受');
        writeCachedThreadProject(rid, confirmed);
        invalidateThreadProjects();
      } catch (err) {
        for (const id of optimistic) removeThreadProjectPin(id);
        throw err;
      }
    },
    [aui, threadIds, threadItems, threadProjects],
  );
}
