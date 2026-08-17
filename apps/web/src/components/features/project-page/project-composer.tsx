/**
 * 项目页顶部的输入框:进了项目就能直接说话。
 *
 * 为什么值得做:对比 Claude 的项目页,最大的差别不是好看,是**落地就有做事的入口**。
 * 我们原来第一件东西是"这个项目还没有文件夹"(一次性设置),想开口还得回侧栏。
 *
 * **一个必须避开的坑**:项目页上的"当前线程"是上次打开的那个。直接挂
 * `ComposerPrimitive` 会把消息发进一个不相干的旧对话 —— 而且发出去了才看得出来。
 * 所以这里是一个自己的输入框:回车时**先新建线程、先钉到本项目**,再把文字交给
 * 真正的 composer 发出去,走的是 project-list.tsx 里那条现成的创建+钉定路径。
 */
import { useCallback, useState, type FC, type KeyboardEvent } from 'react';

import { useAui } from '@assistant-ui/react';

import { useSettingsPanel } from '@/hooks/settings/use-settings-panel';
import { postThreadProject, writeCachedThreadProject } from '@/lib/project-sync';
import { invalidateThreadProjects } from '@/lib/thread-projects-sync';

export const ProjectComposer: FC<{ projectId: string; projectName: string }> = ({
  projectId,
  projectName,
}) => {
  const aui = useAui();
  const { closeWorkspace } = useSettingsPanel();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      // 与 project-list.tsx 的「在项目里新建对话」同一条路:新建 → 强制初始化
      // (拿到真的 threadId 才能立刻钉)→ 钉到本项目。
      await aui.threads().switchToNewThread();
      const item = aui.threads().item('main');
      const initialized = await item.initialize();
      const rid = initialized.remoteId ?? initialized.externalId ?? item.getState().id;
      const confirmed = await postThreadProject(rid, projectId);
      writeCachedThreadProject(rid, confirmed ?? projectId);
      invalidateThreadProjects();

      // 先钉后发:反过来的话,第一条消息会落在一个还没归属的线程里,而"它属于
      // 哪个项目"正是这整套上下文的前提。
      const composer = aui.composer();
      composer.setText(body);
      await composer.send();
      setText('');
      closeWorkspace();   // 让出位置给对话本身
    } catch (err) {
      // 说出来。静默失败的表现是"我打了字、按了回车、什么也没发生"。
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }, [aui, closeWorkspace, projectId, sending, text]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void start();
    }
  };

  return (
    <section className="mb-6">
      <div className="border-border bg-background focus-within:border-foreground/20 rounded-xl border px-3 py-2.5 shadow-sm transition-colors">
        <textarea
          className="placeholder:text-muted-foreground max-h-40 min-h-11 w-full resize-none bg-transparent text-sm outline-none"
          placeholder={`在「${projectName}」里问点什么…`}
          value={text}
          rows={2}
          disabled={sending}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="mt-1 flex items-center justify-between">
          <span className="text-muted-foreground text-xs">
            回车发送 · 新对话会自动归到这个项目
          </span>
          <button
            type="button"
            disabled={!text.trim() || sending}
            onClick={() => void start()}
            className="bg-foreground text-background rounded-md px-3 py-1 text-xs disabled:opacity-40"
          >
            {sending ? '开始中…' : '开始'}
          </button>
        </div>
      </div>
      {error ? <p className="text-destructive mt-1 text-xs">{error}</p> : null}
    </section>
  );
};
