import { useCallback, useEffect, useMemo, useState, type FC } from 'react';
import { CheckIcon, PencilIcon, PlusIcon, SearchIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/features/settings/page-header';
import { useWorkspaceCollapsedInset } from '@/components/features/workspace-view-frame';
import { WorkspaceMain } from '@/components/features/workspace-main';
import { usePanelTabs } from '@/components/assistant-ui/right-panel/panel-tabs-context';
import { useRightSidebar } from '@/components/ui/sidebar';
import { useSettingsPanel } from '@/hooks/settings/use-settings-panel';
import { projectSourceLabel } from '@/lib/project-labels';
import {
  setProjectFolder,
  setProjectInstructions,
  setProjectSources,
  useProjects,
  type ProjectInfo,
} from '@/lib/projects-sync';
import {
  folderPickAvailability,
  pickProjectFolder,
  revealPath,
} from '@/lib/project-folder';
import { normalizeTypedPath } from '@/lib/project-folder-pick';
import { describeFreshness } from '@/lib/freshness';
import { useEnterProjectThread } from './use-project-thread';
import { startWindowDrag } from '@/lib/window-drag';
import { SceneCardCell } from './scene-card-cell';
import { sceneCardColumns, type McpAppToolsByServer } from './scene-card-grid';
import {
  canMergeCards,
  extractDisplayRows,
  extractNarrative,
  type SceneCandidate,
  type SceneNarrative,
} from './scene-card-merge';
import { SceneCardMergeTable } from './scene-card-merge-table';
import { SceneCardSummaryPanel } from './scene-card-summary-panel';
import { ProjectComposer } from './project-composer';
import { ContextPanel, flattenContext } from './context-panel';
import { ContextCards } from './context-cards';
import { toContextCards } from '@/lib/context-cards';
import { RailCard, RailEmpty, RailInlineInput, RailSection } from './project-rail';
import { useSceneCardPayloads, type SceneCardEntry } from './use-scene-card-payloads';

/** Workspace shell for the 项目首页 view — same frame pattern as
 * AutomateWorkspace (drag strip when the rail is collapsed + WorkspaceMain). */
export function ProjectWorkspace() {
  const collapsedInset = useWorkspaceCollapsedInset();

  return (
    <div className="bg-background flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {collapsedInset > 0 ? (
        <div
          data-tauri-drag-region
          className="h-8 shrink-0"
          style={{ paddingLeft: collapsedInset }}
          onMouseDown={startWindowDrag}
        />
      ) : null}
      <WorkspaceMain fill>
        <ProjectOverview />
      </WorkspaceMain>
    </div>
  );
}

/** Fetch the project-scoped MCP-App tool map once per view open (the view is
 * conditionally mounted, so opening it re-fetches; no polling). null = still
 * loading; {} = loaded-or-failed with no capabilities (⇒ no columns, no
 * error — capability absence is not a failure). */
function useProjectAppToolsByServer(projectId: string | undefined): McpAppToolsByServer | null {
  const [byServer, setByServer] = useState<McpAppToolsByServer | null>(null);
  useEffect(() => {
    if (!projectId) {
      setByServer({});
      return;
    }
    let alive = true;
    setByServer(null);
    fetch(`/api/mcp-apps/tools?projectId=${encodeURIComponent(projectId)}`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: { byServer?: McpAppToolsByServer }) => {
        if (alive) setByServer(d.byServer ?? {});
      })
      .catch(() => {
        if (alive) setByServer({});
      });
    return () => {
      alive = false;
    };
  }, [projectId]);
  return byServer;
}

/** The 项目首页: header (name + source labels) and cards grid (rows = sources ×
 * columns = servers exposing get_scene_card). Threads stay in the left rail. */
const ProjectOverview: FC = () => {
  const { t } = useTranslation();
  const { projectPage } = useSettingsPanel();
  const projects = useProjects();
  const project = projects.find((p) => p.id === projectPage?.id);
  const byServer = useProjectAppToolsByServer(project?.id);

  if (!projectPage) return null;
  if (!project) {
    // Deleted/disabled while (or before) the view was open — header keeps the
    // snapshot name, body states the fact once.
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader title={projectPage.name ?? t('projectPage.title')} />
        <p className="text-muted-foreground text-sm">{t('projectPage.notFound')}</p>
      </div>
    );
  }

  // 副标题只在**说了新东西**时才给:数据源标签常常和项目同名(上重/上重),
  // 那样第二行是纯噪音。
  const sourceLabel = project.sources.map(projectSourceLabel).join(' · ');
  const subtitle = sourceLabel && sourceLabel !== project.name ? sourceLabel : undefined;

  // 两栏:**中间做事,右边"这个项目有什么"**。原来一根竖列,于是"设置""认知"
  // "对话"轮流抢最显眼的位置 —— 而进项目最想做的事(说话)反而没有入口。
  // 标题**在两栏之上**,不在左列里 —— 放进左列的话,右栏会从标题的高度开始,
  // 于是右上角那张卡比左边的内容还高一截(实测:看起来就是没对齐)。
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col px-1">
      <PageHeader
        className="mb-3 shrink-0"
        title={project.name}
        {...(subtitle ? { description: subtitle } : {})}
      />
      <div className="flex min-h-0 flex-1 gap-10">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col pr-1">
            <ProjectCardsGrid project={project} byServer={byServer} />
          </div>
          <ProjectComposer projectId={project.id} projectName={project.name} />
        </div>
        {/* 右栏是"有什么",不是"做什么":文件夹、上下文这些是配置和素材,
            它们该在手边,不该挡在路上。 */}
        <aside className="hidden min-h-0 w-72 shrink-0 overflow-y-auto overscroll-contain lg:block">
          <RailCard>
            <ProjectInstructionsSection project={project} />
            <ProjectSourcesSection project={project} />
            <ProjectContextSection project={project} />
            <ProjectFolderRow project={project} />
            <ProjectWorkflowsSection project={project} />
          </RailCard>
        </aside>
      </div>
    </div>
  );
};

/**
 * 这个项目里的工作流(含定时)。
 *
 * 和 Claude 的 Instructions / Context / Scheduled 同一层:工作流属于项目,所以
 * **场景是继承的** —— 一个"找瓶颈"的工作流在上重项目里就是上重的,不用把工厂
 * 抽象成参数(用户定的)。
 *
 * 空状态说的是**它从哪来**:工作流不是在这里从零写的,是从一段对话结晶出来的。
 */
const ProjectWorkflowsSection: FC<{ project: ProjectInfo }> = ({ project }) => {
  const [items, setItems] = useState<Array<{ id: string; name: string; cron?: string }> | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch('/api/workflows');
        const body = (await res.json()) as { workflows?: Array<{ id: string; name: string; cron?: string }> };
        if (alive) setItems(body.workflows ?? []);
      } catch {
        /* 取不到就当没有 —— 这一段是陈述,不该报错打断人 */
      }
    })();
    return () => { alive = false; };
  }, [project.id]);

  const list = items ?? [];
  const scheduled = list.filter((w) => w.cron);

  return (
    <RailSection
      title="工作流"
      {...(list.length
        ? { hint: String(list.length) }
        : {})}
    >
      {list.length === 0 ? (
        <RailEmpty>
          在消息上点「结晶成工作流」,<br />下次一键重跑。
        </RailEmpty>
      ) : (
        <ul className="space-y-1">
          {list.slice(0, 6).map((w) => (
            <li key={w.id} className="flex items-baseline gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate">{w.name}</span>
              {/* 定时和工作流不分成两段:一个有定时的工作流仍然是同一个东西,
                  拆开会让人以为要建两次。 */}
              {w.cron ? <span className="text-muted-foreground shrink-0">定时</span> : null}
            </li>
          ))}
        </ul>
      )}
    </RailSection>
  );
};

/**
 * 项目说明 —— **会作为项目级指令喂给模型**(chat.ts buildProjectPinBlock)。
 *
 * 所以它不是备注:提示语必须说清"写进去会影响这个项目里所有对话",否则人会当成
 * 一句给自己看的注解随手写。
 */
const ProjectInstructionsSection: FC<{ project: ProjectInfo }> = ({ project }) => {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(project.instructions ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setText(project.instructions ?? ''); }, [project.instructions]);

  const save = async () => {
    setBusy(true);
    const res = await setProjectInstructions(project.id, text.trim());
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setError(null);
    setEditing(false);
  };

  return (
    <RailSection
      title="项目说明"
      action={{
        icon: editing ? <CheckIcon className="size-4" /> : project.instructions
          ? <PencilIcon className="size-4" />
          : <PlusIcon className="size-4" />,
        label: editing ? '完成' : project.instructions ? '改说明' : '写一句说明',
        onClick: () => (editing ? void save() : setEditing(true)),
      }}
    >
      {editing ? (
        <textarea
          autoFocus
          className="border-input min-h-20 w-full resize-none rounded border px-2 py-1.5 text-xs"
          placeholder="想达成什么、有什么约定或禁忌…"
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
        />
      ) : project.instructions ? (
        <p className="text-muted-foreground text-xs leading-relaxed whitespace-pre-wrap">
          {project.instructions}
        </p>
      ) : (
        <RailEmpty>写一句这个项目要做什么,<br />它会进入这里的每次对话。</RailEmpty>
      )}
      {error ? <p className="text-destructive mt-1 text-xs">{error}</p> : null}
    </RailSection>
  );
};

/**
 * 这个项目用哪些数据源。
 *
 * 建项目时**不必选**(见 project-list.tsx 的说明),所以那句"以后随时能加"要在这里
 * 落地。看得到什么取决于你在 Compass 那边被授权的场景 —— 这里只是从中挑。
 *
 * **只能加,不能换。** 项目里已有的对话是照着旧数据源的数据得出的结论,换掉之后
 * 那些结论就和数据对不上了,而对话还留在这个项目里(见 project-sources-immutable.ts)。
 * 所以已挂上的那几个是**勾上且不可取消**的,动作叫「加」不叫「改」。
 *
 * **系统管的项目(managed)连加都不给。** 它的数据源由 reconciler 维护,后端直接
 * 403 —— 从前这里照样显示「改」,点了必然失败:一个只会让人白点一次的按钮,
 * 比没有按钮坏。
 */
const ProjectSourcesSection: FC<{ project: ProjectInfo }> = ({ project }) => {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const granted = useGrantedSources();
  const picked = new Set(project.sources);

  /** 只加。已挂上的点不动(界面上就是禁用的),这里再挡一次。 */
  const add = async (source: string) => {
    if (busy || picked.has(source)) return;
    const next = new Set(picked);
    next.add(source);
    setBusy(true);
    const res = await setProjectSources(project.id, [...next]);
    setBusy(false);
    if (!res.ok) setError(res.error);
    else setError(null);
  };

  return (
    <RailSection
      title="数据源"
      // **数据源 = 远端接来的、会变的数据**;本地文件属于「上下文」那一段。
      // 两段以前的空状态措辞是混着的("上下文"里也叫人去连数据源),于是没人
      // 分得清哪个是哪个 —— 而这两者的新鲜度、权威性、能不能改都不一样。
      action={
        // managed 项目不给动作 —— 后端 403,给了就是个只会失败的按钮。
        granted.length && !project.managed
          ? {
              icon: editing ? <CheckIcon className="size-4" /> : <PlusIcon className="size-4" />,
              label: editing ? '完成' : '加数据源',
              onClick: () => setEditing((v) => !v),
            }
          : undefined
      }
      {...(project.sources.length
        ? { hint: project.sources.map(projectSourceLabel).join('、') }
        : {})}
    >
      {project.sources.length === 0 && !editing ? (
        // 说的是**没选会怎样**,而不是"没选"。
        // **不写"排产"** —— 数据源是接远端系统这件事本身,今天是排产,以后可能是
        // 质量、设备。写死一个领域,别的接进来时这句话就成了假话。
        <RailEmpty>
          接上远端系统,<br />就能直接查它那边的实时数据。
        </RailEmpty>
      ) : null}
      {editing ? (
        // 说清楚为什么只能加 —— 不说,人会以为是漏做了取消勾选。
        <p className="text-muted-foreground mb-1.5 text-xs leading-relaxed">
          只能加,不能摘。这个项目里已有的对话是照着现在这些数据源得出的结论,
          换掉它们那些结论就对不上了。要换 → 新建一个项目。
        </p>
      ) : null}
      {editing ? (
        <div className="flex flex-col gap-1.5">
          {granted.map((s) => {
            const already = picked.has(s);
            return (
              <label
                key={s}
                className={`flex items-center gap-2 text-xs ${already ? '' : 'cursor-pointer'}`}
                {...(already ? { title: '已经在用了 —— 数据源只能加,不能摘掉' } : {})}
              >
                <input
                  type="checkbox"
                  className="accent-primary size-3.5"
                  checked={already}
                  // 已挂上的**禁用**:能点却会被后端拒,是最难受的一种界面。
                  disabled={busy || already}
                  onChange={() => void add(s)}
                />
                <span className={already ? 'text-muted-foreground' : ''}>
                  {projectSourceLabel(s)}
                  {already ? ' · 已在用' : ''}
                </span>
              </label>
            );
          })}
          {granted.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              还没有可用的远端系统 —— 先在 设置 → MCP 里连一个。
            </p>
          ) : null}
        </div>
      ) : null}
      {error ? <p className="text-destructive mt-1 text-xs">{error}</p> : null}
    </RailSection>
  );
};

/** 这个账号在 Compass 被授权的场景 —— 项目只能从中挑,不能自己扩。 */
function useGrantedSources(): string[] {
  const [sources, setSources] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch('/api/compass-identity/whoami');
        const body = (await res.json()) as { sources?: string[] };
        if (alive && Array.isArray(body.sources)) setSources(body.sources);
      } catch {
        /* 取不到就当没有 —— 这一段是陈述,不该报错打断人 */
      }
    })();
    return () => { alive = false; };
  }, []);
  return sources;
}

/**
 * 项目文件夹(spec 2026-08-14 §2)。
 *
 * 这一行要回答的不是"设了没有",而是**没设会怎样** —— 导入的原件不会留档,只存
 * 解析出来的行。浏览器里选不了目录(拿不到绝对路径),那就说清楚为什么并指向桌面端,
 * 而不是给一个点了没反应的按钮。
 */
const ProjectFolderRow: FC<{ project: ProjectInfo }> = ({ project }) => {
  const [folder, setFolder] = useState<string | undefined>(project.folder);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [typing, setTyping] = useState(false);
  const availability = folderPickAvailability();
  const shownFolder = folder;

  useEffect(() => { setFolder(project.folder); }, [project.folder]);

  const bind = async (path: string) => {
    const clean = normalizeTypedPath(path);
    if (!clean) return;
    const res = await setProjectFolder(project.id, clean);
    if (res.ok) {
      setFolder(res.project.folder);
      setError(null);
    } else {
      setError(res.error);
    }
  };

  // 原生面板会挂住(实测),所以它只是便利:超时就请用户粘路径,界面不吊死。
  const choose = async () => {
    setError(null);
    setPicking(true);
    try {
      const out = await pickProjectFolder();
      if (out.status === 'picked') await bind(out.path);
      else if (out.status === 'timeout') { setError('系统选择框没有响应 —— 把路径粘进来就行。'); setTyping(true); }
      else if (out.status === 'unavailable') { setError('打不开系统选择框 —— 把路径粘进来就行。'); setTyping(true); }
    } finally {
      setPicking(false);
    }
  };

  return (
    <RailSection
      title="项目文件夹"
      action={{
        icon: folder ? <PencilIcon className="size-4" /> : <PlusIcon className="size-4" />,
        label: folder ? '换一个文件夹' : '选一个文件夹',
        onClick: () => (availability.canPick ? void choose() : setTyping(true)),
      }}
      {...(shownFolder ? { hint: shownFolder } : {})}
    >
      {typing && !shownFolder ? (
        <RailInlineInput
          placeholder="把文件夹路径粘到这里"
          submitLabel="使用"
          onSubmit={(v) => { void bind(v); setTyping(false); }}
          onCancel={() => setTyping(false)}
        />
      ) : null}
      {folder ? (
        <button
          type="button"
          onClick={async () => {
            // **失败要说话。** 从前 revealPath 返回 false 就没人管了,
            // 表现成"点了没反应" —— 最难查的一种。
            const ok = await revealPath(folder, undefined, project.id);
            if (!ok) setError('打不开访达 —— 这个文件夹可能已经不在了');
          }}
          className="text-muted-foreground hover:text-foreground text-xs underline"
        >
          在访达中显示
        </button>
      ) : null}
      {error ? <p className="text-destructive mt-1 text-xs">{error}</p> : null}
    </RailSection>
  );
};

type ProjectContext = {
  folder: string | null;
  originals: Array<{ name: string; bytes: number; importedAt: string; seenCount: number }>;
  snapshots: Array<{ name: string; bytes: number; at: string }>;
  /** 文件夹里躺着的、我们生成的、可编辑副本 —— 都算上下文 */
  files?: Array<{ name: string; bytes: number; at: string; where: 'folder' | 'generated' | 'draft' }>;
  connectors: Array<{ server: string; tenant?: string; oldestLoadedAt: string; sheets: string[] }>;
};

/**
 * 项目里到底有什么(形状取自 Claude 项目页的 Context 栏)。
 *
 * **两类分开说**:文件存下来就不变;连接器会腐烂,所以每条都带「上次刷新」——
 * 那是这条线上最后一个还没露脸的事实。
 */
/** 少于这个数就不给搜索框:三五个文件用眼睛找更快,多一个空控件只是噪音。 */
const SEARCH_FROM = 6;

const ProjectContextSection: FC<{ project: ProjectInfo }> = ({ project }) => {
  const { openDocument } = usePanelTabs();
  const { setOpen: setRightOpen } = useRightSidebar();
  const { closeWorkspace } = useSettingsPanel();
  const enterProjectThread = useEnterProjectThread();
  const [data, setData] = useState<ProjectContext | null>(null);
  const [q, setQ] = useState('');
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // 问的是**这一页正在显示的项目**,不是当前线程钉着的那个。
        const res = await fetch(`/api/project/context?projectId=${encodeURIComponent(project.id)}`);
        const body = (await res.json()) as { ok?: boolean } & ProjectContext;
        if (!cancelled && body.ok) setData(body);
      } catch {
        /* 读不到就不显示这一栏 —— 它是陈述,不该报错打断人 */
      }
    })();
    return () => { cancelled = true; };
  }, [project.id, project.folder]);

  const kw = q.trim().toLowerCase();
  const hit = (s: string) => !kw || s.toLowerCase().includes(kw);
  const shown = data;
  // 搜索是**过滤已经在这儿的东西**,不是去后端再查一遍 —— 这一栏本来就是全量。
  const connectors = (shown?.connectors ?? []).filter(
    (c) => hit(c.tenant ?? c.server) || c.sheets.some(hit),
  );
  const originals = (shown?.originals ?? []).filter((f) => hit(f.name));
  const snapshots = (shown?.snapshots ?? []).filter((f) => hit(f.name));
  // 文件夹里躺着的文件也算 —— 漏掉它们,项目页会显示"上下文是空的",而文件夹里
  // 明明放着四份文档(实测)。
  const files = (shown?.files ?? []).filter((f) => hit(f.name));
  const total = shown
    ? shown.connectors.length + shown.originals.length + shown.snapshots.length + (shown.files?.length ?? 0)
    : 0;
  // 过滤在卡片之前做完 —— 搜索是筛"已经在这儿的东西",卡片只管怎么摆。
  const cards = useMemo(
    () => (data ? toContextCards({ ...data, originals, snapshots, files }) : []),
    [data, originals, snapshots, files],
  );

  // 卡片和上下文面板里的「在右侧打开」是同一件事,别写两份。
  const openInRightPanel = useCallback(
    (name: string) => {
      setRightOpen(true);
      // **顺序是有讲究的:先落线程,再开文档。**
      //
      // 1) 先落到本项目的对话 —— 项目页要给右侧面板让位而关掉,底下露出来的是你
      //    上次看的那条,可能属于别的项目(实测:在「上重」点开快照,人落到了
      //    「caliper-测试」里,右边却显示上重的文件)。面板和对话各说各的,下一句
      //    就发错项目了。
      // 2) **面板标签是按线程存的**,切线程会把标签冲掉 —— 先开文档再切,标签当场
      //    消失,右边只剩"选面板类型"那张空卡(e2e 里当场复现)。
      void (async () => {
        try {
          await enterProjectThread(project.id);
        } finally {
          openDocument({ projectId: project.id, name });
          closeWorkspace();
        }
      })();
    },
    [openDocument, project.id, setRightOpen, closeWorkspace, enterProjectThread],
  );

  return (
    <RailSection
      title="上下文"
      {...(total > 0
        ? {
            action: {
              icon: <SearchIcon className="size-4" />,
              label: '搜索和预览',
              onClick: () => setPanelOpen(true),
            },
          }
        : {})}
      {...(total === 0 ? {} : { hint: `${total} 项 · 可直接引用` })}
    >
      {total === 0 ? (
        // 空状态说清**放什么**,而不是整段消失 —— 消失的话人不知道这里可以放东西。
        // **这一段只说本地的东西。** 原来这里也写"连上数据源",于是和上面那段
        // 讲的是同一件事,人分不清区别 —— 而远端数据会变、本地留档不会变,
        // 这个区别恰恰是最该讲清楚的。
        <RailEmpty>
          导入表格,或给项目设一个文件夹,<br />之后在对话里直接引用。
        </RailEmpty>
      ) : null}
      {/* 侧栏里超过一屏就没法看了 —— 多的交给面板,这里只给搜索当快筛。 */}
      {total > SEARCH_FROM ? (
        <input
          className="border-input mb-2 h-7 w-full rounded border px-2 text-xs"
          placeholder="搜索…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      ) : null}
      {panelOpen && shown ? (
        <ContextPanel
          items={flattenContext(shown)}
          projectId={project.id}
          onClose={() => setPanelOpen(false)}
          // 右栏收起时只加一个 tab 等于什么也没发生 —— 人点了「在右侧打开」,
          // 项目页关掉了,右边一片空白(实测)。要连着展开右栏并给项目页让位。
          onOpenInPanel={openInRightPanel}
        />
      ) : null}

      {connectors.length > 0 ? (
        <ul className="mb-2 space-y-1">
          {connectors.slice(0, 2).map((c) => (
            <li key={`${c.server}-${c.tenant ?? ''}`} className="truncate text-xs">
              {c.tenant ?? c.server}
            </li>
          ))}
        </ul>
      ) : null}

      {cards.length > 0 ? (
        <ContextCards
          cards={cards}
          projectId={project.id}
          onOpenFile={openInRightPanel}
          onOpenFolder={() => setPanelOpen(true)}
        />
      ) : null}

      {/* 搜不到要说一声 —— 空白会被读成"这儿本来就没东西"。 */}
      {kw && connectors.length + cards.length === 0 ? (
        <p className="text-muted-foreground text-xs">没有匹配「{q}」的项</p>
      ) : null}
    </RailSection>
  );
};

/**
 * 体检卡加载占位:必须先占住和成卡差不多的高度。
 * 空转圈只有 min-h-24 时,卡一出来会把下面的对话列表整段顶下去。
 */
function SceneCardSummarySkeleton() {
  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-3">
      <section className="border-border/60 shrink-0 rounded-xl border px-4 py-3.5">
        <div className="flex items-center gap-2">
          <div className="bg-muted h-4 w-28 animate-pulse rounded" />
          <div className="bg-muted h-5 w-24 animate-pulse rounded-full" />
        </div>
        <div className="bg-muted mt-2 h-3 w-64 animate-pulse rounded" />
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="bg-muted/50 h-14 animate-pulse rounded-lg" />
          ))}
        </div>
      </section>
      <div className="border-border/60 bg-muted/20 min-h-0 flex-1 animate-pulse rounded-lg border" />
    </div>
  );
}

/**
 * The cards area, in one of two shapes:
 * - 对比合并视图 — a multi-scene project whose cards ALL carry the generic
 *   `display` contract collapses into one comparison table;
 * - side-by-side widget cells — every other case (single scene, a card that
 *   failed, a card whose server ships no `display`). Honest degradation: the
 *   page never merges half a comparison.
 */
const ProjectCardsGrid: FC<{
  project: ProjectInfo;
  byServer: McpAppToolsByServer | null;
}> = ({ project, byServer }) => {
  const { t } = useTranslation();
  const hostUrl = `/api/mcp-apps/host?projectId=${encodeURIComponent(project.id)}`;
  const columns = useMemo(() => sceneCardColumns(byServer), [byServer]);
  const { entries, at, revalidating, refresh } = useSceneCardPayloads(
    hostUrl, columns, project.sources);

  // One page-level loader for the whole area (the calls settle together), so
  // the merge decision is made once instead of flickering through it. Bounded:
  // each call carries its own deadline (SCENE_CARD_FETCH_TIMEOUT_MS), so a
  // capability server that never answers can no longer hold this loader — it
  // settles as a failed card and the page degrades to side-by-side.
  if (byServer === null || entries === null) {
    return (
      <div className="flex min-h-0 flex-1 flex-col" aria-busy="true" aria-label={t('projectPage.loading')}>
        <SceneCardSummarySkeleton />
      </div>
    );
  }

  // No server exposes get_scene_card — the grid simply doesn't exist (normal
  // capability absence, not an error state).
  if (columns.length === 0) return null;

  // 眼前这批卡有多旧 + 一个手动刷新 —— 不定时轮询(用户定的规矩),但要能看出
  // 它是什么时候的,也要能自己叫它更新。
  const freshness = (
    <div className="mb-1.5 flex shrink-0 justify-end">
      <button
        type="button"
        onClick={refresh}
        disabled={revalidating}
        className="text-muted-foreground hover:text-foreground text-[11px] disabled:opacity-50"
        title={at ? describeFreshness(at) : undefined}
      >
        {revalidating ? '…' : '刷新'}
      </button>
    </div>
  );

  const candidates: SceneCandidate[] = entries.map((e) => ({
    source: e.source,
    rows: e.fetched.status === 'ready' ? extractDisplayRows(e.fetched.result) : null,
  }));

  if (canMergeCards(candidates)) {
    const narratives = entries
      .map((e) => (e.fetched.status === 'ready' ? extractNarrative(e.source, e.fetched.result) : null))
      .filter((n): n is SceneNarrative => n !== null);
    // Column sub-labels only when >1 capability server answers — otherwise a
    // scene's single column needs no qualifier (一个事实一处表达).
    const servers = new Set(entries.map((e) => e.server));
    return (
      <div>
        {freshness}
        <SceneCardMergeTable
          scenes={candidates.map((c) => ({ source: c.source, rows: c.rows! }))}
          serverLabels={
            servers.size > 1 ? entries.map((e) => e.server) : undefined
          }
          narratives={narratives}
          projectId={project.id}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {freshness}
      <div
        className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] gap-4"
        style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
      >
      {entries.map((entry: SceneCardEntry) => {
        const key = `${entry.source}::${entry.server}`;
        if (entry.fetched.status === 'ready') {
          const rows = extractDisplayRows(entry.fetched.result);
          if (rows) {
            const narrative = extractNarrative(entry.source, entry.fetched.result);
            return (
              <SceneCardSummaryPanel
                key={key}
                rows={rows}
                source={entry.source}
                projectId={project.id}
                narrative={
                  narrative
                    ? { text: narrative.text, generatedAt: narrative.generatedAt }
                    : null
                }
              />
            );
          }
        }
        return (
          <SceneCardCell
            key={key}
            hostUrl={hostUrl}
            resourceUri={entry.resourceUri}
            server={entry.server}
            source={entry.source}
            projectId={project.id}
            fetched={entry.fetched}
            args={entry.args}
            argsKey={entry.argsKey}
          />
        );
      })}
      </div>
    </div>
  );
};
