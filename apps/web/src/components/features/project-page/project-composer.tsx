/**
 * 项目页顶部的输入框:进了项目就能直接说话。
 *
 * **用的就是对话里那个真 composer**(thread.tsx 的 `Composer`),不是复刻一个 ——
 * 原来这里自己搭了个简化 textarea,于是同一件事在两个地方长得不一样、能力也不
 * 一样(缺 + 号、附件、技能、模型选择),而用户没道理理解这个区别。
 *
 * **但真 composer 是挂在"当前线程"上的**,而项目页的当前线程是你上次打开的那个 ——
 * 直接挂上去,消息会发进一个不相干的旧对话,而且发出去了才看得出来。
 *
 * 所以这里做的唯一一件事:**在你动手之前**(focus 那一刻)把当前线程换成一条
 * 新的、并钉到本项目。之后打字、贴附件、发送全走原来那条路。
 *
 * 为什么是 focus 不是 mount:进项目页不等于要说话。挂载就建线程,会给每次浏览
 * 都留下一条空对话。
 */
import { useCallback, useEffect, useRef, useState, type FC } from 'react';

import { useAuiState } from '@assistant-ui/react';

import { Composer } from '@/components/assistant-ui/thread';
import { useSettingsPanel } from '@/hooks/settings/use-settings-panel';
import { setPendingProjectHint } from '@/lib/pending-project-hint';
import { useEnterProjectThread } from './use-project-thread';

export const ProjectComposer: FC<{ projectId: string; projectName: string }> = ({
  projectId,
  projectName,
}) => {
  const enterProjectThread = useEnterProjectThread();
  const { closeWorkspace } = useSettingsPanel();
  const [error, setError] = useState<string | null>(null);
  const preparing = useRef(false);
  const prepared = useRef(false);
  const messageCount = useAuiState((s) => s.thread.messages.length);
  const armed = useRef(false);

  /** 换到一条新线程并钉到本项目。**只做一次**,而且在用户打字之前。 */
  const prepare = useCallback(async () => {
    if (prepared.current || preparing.current) return;
    preparing.current = true;
    try {
      // 在项目页打字 = 开一条新对话,所以不复用已有的(reuse: false)。
      // 钉定那套(强制 initialize 拿真 id 再钉)在 hook 里,和卡片那条路共用。
      await enterProjectThread(projectId, { reuse: false });
      prepared.current = true;
      armed.current = true;
      setError(null);
    } catch (err) {
      // 说出来。静默失败的表现是"我打了字、按了回车,消息去了别的对话"。
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      preparing.current = false;
    }
  }, [enterProjectThread, projectId]);

  // 发出去之后让位给对话本身。armed 保证只对**这次**准备好的线程生效,
  // 不会因为切到别的历史线程就把项目页关掉。
  useEffect(() => {
    if (armed.current && messageCount > 0) {
      armed.current = false;
      closeWorkspace();
    }
  }, [messageCount, closeWorkspace]);

  return (
    <section
      className="mt-4 shrink-0"
      onFocusCapture={() => {
        // 立刻记下"我在这个项目里说话" —— prepare() 是异步的,而发送不等它。
        setPendingProjectHint(projectId);
        void prepare();
      }}
    >
      <p className="text-muted-foreground mb-1.5 text-xs">
        在「{projectName}」里问点什么 —— 新对话会自动归到这个项目
      </p>
      {/* 不自动聚焦:聚焦=「我要说话」,是新建并钉定线程的信号。自动聚焦会让
          每次打开项目页都留下一条空对话(实测踩到)。 */}
      {/* chip 显示**本页项目**:这时候还没有线程,读当前线程会答成上次那个。 */}
      <Composer autoFocus={false} projectName={projectName} />
      {error ? <p className="text-destructive mt-1 text-xs">{error}</p> : null}
    </section>
  );
};
