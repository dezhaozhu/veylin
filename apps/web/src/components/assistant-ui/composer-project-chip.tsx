/**
 * 输入框上的「项目」—— **能点的选择器**(形状参考 Claude 的 Project or folder)。
 *
 * 从前这里是个只读的 div,注释写着 "indicator, not a picker":换项目只能去侧栏。
 * 可它长得就像个可点的东西、又摆在最显眼的位置,用户第一反应就是点它
 * (实测原话:"这里是项目,但又不能点")。
 *
 * 每一行**把文件夹路径一起写出来**:大多数活其实落在本地,路径就是这个项目
 * "到底对着哪堆文件"的唯一答案;没绑的也明说一句,而不是留白让人猜。
 *
 * 定位复用「+」菜单那条:方向按可用空间选 —— 聊天页输入框在底部(向上弹),
 * 项目页在顶部(向下弹)。
 */
import { CheckIcon, FolderIcon, FolderOpenIcon, PlusIcon } from 'lucide-react';
import { useCallback, useLayoutEffect, useRef, useState, type FC } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { ComposerMenuPanel } from '@/components/assistant-ui/composer-menu-flyout';
import { DismissibleBackdrop } from '@/components/ui/dismissible-backdrop';
import { projectLabel } from '@/lib/project-labels';
import { plusMenuPlacement, type PlusMenuPlacement } from '@/lib/plus-menu-placement';
import { projectPickerRows, shortPath } from '@/lib/project-picker';
import { createProject, invalidateProjects, useProjects } from '@/lib/projects-sync';
import { invalidateThreadProjects } from '@/lib/thread-projects-sync';
import { writeCachedThreadProject } from '@/lib/project-sync';
import { useProjectScope } from '@/lib/use-composer-settings';
import { cn } from '@/lib/utils';

/** 少于这个数就不给搜索框 —— 三五个项目用眼睛找更快。 */
const SEARCH_FROM = 6;

async function pinThread(threadId: string, project: string | null): Promise<void> {
  await fetch('/api/project', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ threadId, project }),
  });
  // 两份缓存都写:共享那份是分组用的,本地那份是 chip 在共享还没有条目时的兜底。
  // 只写共享的话,取消钉定后本地那份还留着旧项目,chip 会显示成没取消(兜底反噬)。
  writeCachedThreadProject(threadId, project);
  invalidateThreadProjects();
}

export const ComposerProjectChip: FC<{
  /**
   * 项目页把**本页项目**直接给过来:那儿在用户动手之前还没有线程,读"当前线程
   * 钉在哪"会答成上次打开的那个项目(实测:caliper 页面上显示「111」)。
   * 给了就只显示、不给选 —— 这一页的项目不是待选项。
   */
  fixedProjectName?: string;
}> = ({ fixedProjectName }) => {
  const { t } = useTranslation();
  const { threadId, currentProject } = useProjectScope();
  const projects = useProjects();
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<PlusMenuPlacement | null>(null);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  useLayoutEffect(() => {
    if (!open) { setAnchor(null); return; }
    const update = () => {
      const el = anchorRef.current;
      if (el) setAnchor(plusMenuPlacement(el.getBoundingClientRect(), window.innerHeight));
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    setQ('');
    setCreating(false);
    setNewName('');
  }, []);

  const pick = useCallback(
    async (project: string | null) => {
      close();
      if (!threadId) return;
      await pinThread(threadId, project);
    },
    [close, threadId],
  );

  if (fixedProjectName) {
    return (
      <span
        className="text-muted-foreground inline-flex h-7 max-w-[10rem] min-w-0 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs"
        title={fixedProjectName}
      >
        <FolderIcon className="size-3 shrink-0" />
        <span className="truncate">{fixedProjectName}</span>
      </span>
    );
  }

  if (projects.length === 0) return null;

  // 悬空的钉子(项目被删/禁用):projectLabel 只认旧的条目名,认不出的 id 会直接
  // 显示成一串 UUID —— 那还不如老实说"用不了"。
  const legacyOrFallback = (pin: string) => {
    const legacy = projectLabel(pin);
    return legacy === pin && pin.includes('-') ? t('mention.projectUnavailable') : legacy;
  };
  const label = currentProject
    ? (projects.find((p) => p.id === currentProject)?.name ?? legacyOrFallback(currentProject))
    : t('mention.project');

  const rows = projectPickerRows(projects, q, currentProject);

  const submitNew = async () => {
    const name = newName.trim();
    if (!name) return;
    // 不选数据源:这条路是"先把活归拢起来",远端要接以后在项目页随时能加。
    const res = await createProject(name, []);
    if (!res.ok) return;
    invalidateProjects();
    await pick(res.project.id);
  };

  return (
    <div ref={anchorRef} className="relative shrink-0">
      <button
        type="button"
        title={t('mention.projectSwitchHint')}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'text-muted-foreground hover:bg-muted-foreground/15 hover:text-foreground',
          'inline-flex h-7 max-w-[10rem] min-w-0 shrink-0 items-center gap-1 rounded-full',
          'px-2.5 text-xs font-normal transition-colors',
        )}
      >
        <FolderIcon className="size-3 shrink-0" />
        <span className={cn('truncate', !currentProject && 'italic')}>{label}</span>
      </button>

      {open && anchor
        ? createPortal(
            <>
              <DismissibleBackdrop ariaLabel={t('mention.close')} onClose={close} />
              <div
                className="fixed z-[201]"
                style={{
                  left: anchor.left,
                  width: anchor.width,
                  ...(anchor.top === undefined ? {} : { top: anchor.top }),
                  ...(anchor.bottom === undefined ? {} : { bottom: anchor.bottom }),
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <ComposerMenuPanel className="min-w-[280px]">
                  {projects.length >= SEARCH_FROM ? (
                    <div className="px-1 pb-1">
                      <input
                        autoFocus
                        type="search"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="搜索项目…"
                        className="border-input bg-background placeholder:text-muted-foreground h-8 w-full rounded-md border px-2.5 text-xs outline-none"
                      />
                    </div>
                  ) : null}

                  <div className="max-h-64 overflow-y-auto">
                    {rows.map((row) => (
                      <button
                        key={row.id}
                        type="button"
                        onClick={() => void pick(row.id)}
                        className="hover:bg-muted flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left"
                      >
                        <FolderIcon className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs">{row.name}</span>
                          {/* 路径就是这个项目"对着哪堆文件"的唯一答案 —— 没绑也要说。 */}
                          <span className="text-muted-foreground block truncate text-[11px]">
                            {row.folder ? shortPath(row.folder) : '未设文件夹'}
                          </span>
                        </span>
                        {row.current ? <CheckIcon className="mt-0.5 size-3.5 shrink-0" /> : null}
                      </button>
                    ))}
                    {rows.length === 0 ? (
                      <p className="text-muted-foreground px-2 py-1.5 text-xs">没有匹配的项目</p>
                    ) : null}
                  </div>

                  <div className="border-border/60 mt-1 border-t pt-1">
                    {currentProject ? (
                      <button
                        type="button"
                        onClick={() => void pick(null)}
                        className="hover:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs"
                      >
                        <FolderOpenIcon className="text-muted-foreground size-3.5 shrink-0" />
                        不归到项目
                      </button>
                    ) : null}

                    {creating ? (
                      <form
                        className="flex items-center gap-1 px-2 py-1"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void submitNew();
                        }}
                      >
                        <input
                          autoFocus
                          value={newName}
                          onChange={(e) => setNewName(e.target.value)}
                          placeholder="项目名"
                          className="border-input bg-background h-7 min-w-0 flex-1 rounded-md border px-2 text-xs outline-none"
                        />
                        <button
                          type="submit"
                          disabled={!newName.trim()}
                          className="text-muted-foreground hover:text-foreground shrink-0 text-xs disabled:opacity-40"
                        >
                          建
                        </button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setCreating(true)}
                        className="hover:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs"
                      >
                        <PlusIcon className="text-muted-foreground size-3.5 shrink-0" />
                        新建项目
                      </button>
                    )}
                  </div>
                </ComposerMenuPanel>
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  );
};
