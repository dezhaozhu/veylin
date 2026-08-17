import { useEffect, useMemo, useState, type FC } from 'react';
import { ThreadListPrimitive, useAuiState } from '@assistant-ui/react';
import { FolderOpen, LoaderIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  ThreadActivityContext,
  ThreadListItem,
} from '@/components/assistant-ui/thread-list-item';
import { PageHeader, SectionHeading } from '@/components/features/settings/page-header';
import { useWorkspaceCollapsedInset } from '@/components/features/workspace-view-frame';
import { WorkspaceMain } from '@/components/features/workspace-main';
import { usePanelTabs } from '@/components/assistant-ui/right-panel/panel-tabs-context';
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
import { useThreadProjects } from '@/lib/thread-projects-sync';
import { useThreadActivityMap } from '@/lib/use-thread-activity';
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
import { ProjectComposer } from './project-composer';
import { ContextPanel, flattenContext } from './context-panel';
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
      <WorkspaceMain>
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

/** The 项目首页: header (name + source labels), cards grid (rows = sources ×
 * columns = servers exposing get_scene_card), and the project's thread list.
 * Deliberately the ONLY chrome this page adds — no composer additions, no
 * status rows; each card's density lives inside the server-rendered widget. */
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
    <div className="mx-auto w-full max-w-6xl px-1">
      <PageHeader title={project.name} {...(subtitle ? { description: subtitle } : {})} />
      <div className="flex gap-6">
        <div className="flex min-w-0 flex-1 flex-col">
          <ProjectComposer projectId={project.id} projectName={project.name} />
          <ProjectCardsGrid project={project} byServer={byServer} />
          <ProjectThreads projectId={project.id} />
        </div>
        {/* 右栏是"有什么",不是"做什么":文件夹、上下文这些是配置和素材,
            它们该在手边,不该挡在路上。 */}
        <aside className="hidden w-80 shrink-0 lg:block">
          {/* 一张卡、细线分段 —— 三个孤立的边框看起来就是三块没关系的东西。 */}
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
        ? { hint: `${list.length} 个${scheduled.length ? ` · ${scheduled.length} 个有定时` : ''}` }
        : {})}
    >
      {list.length === 0 ? (
        <RailEmpty>
          聊出一套做法之后,在那条消息上点<br />「结晶成工作流」,下次一键重跑。
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
      action={{ label: editing ? '完成' : project.instructions ? '改' : '＋',
                onClick: () => (editing ? void save() : setEditing(true)) }}
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
        <RailEmpty>写一句这个项目要做什么。<br />它会跟着进这个项目的每一次对话。</RailEmpty>
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
 */
const ProjectSourcesSection: FC<{ project: ProjectInfo }> = ({ project }) => {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const granted = useGrantedSources();
  const picked = new Set(project.sources);

  const toggle = async (source: string) => {
    if (busy) return;
    const next = new Set(picked);
    if (next.has(source)) next.delete(source);
    else next.add(source);
    setBusy(true);
    const res = await setProjectSources(project.id, [...next]);
    setBusy(false);
    if (!res.ok) setError(res.error);
    else setError(null);
  };

  return (
    <RailSection
      title="数据源"
      action={
        granted.length
          ? { label: editing ? '完成' : '改', onClick: () => setEditing((v) => !v) }
          : undefined
      }
      {...(project.sources.length
        ? { hint: project.sources.map(projectSourceLabel).join('、') }
        : {})}
    >
      {project.sources.length === 0 && !editing ? (
        // 说的是**没选会怎样**,而不是"没选"。
        <RailEmpty>
          这个项目只用你自己的文件。<br />接上数据源后,对话里就能直接查排产数据。
        </RailEmpty>
      ) : null}
      {editing ? (
        <div className="flex flex-col gap-1.5">
          {granted.map((s) => (
            <label key={s} className="flex cursor-pointer items-center gap-2 text-xs">
              <input
                type="checkbox"
                className="accent-primary size-3.5"
                checked={picked.has(s)}
                disabled={busy}
                onChange={() => void toggle(s)}
              />
              <span>{projectSourceLabel(s)}</span>
            </label>
          ))}
          {granted.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              Compass 还没给你任何数据源 —— 先在 设置 → MCP 里连接。
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
        label: folder ? '换' : '＋',
        title: folder ? '换一个文件夹' : '选一个文件夹',
        onClick: () => (availability.canPick ? void choose() : setTyping(true)),
      }}
      {...(folder ? { hint: folder } : {})}
    >
      {!folder && !typing ? (
        // 说的是**没设会怎样**,不是"没设"。而且一句话说完 —— 原来那句长到被截断,
        // 读者只看到"导入…"。
        <RailEmpty>
          文件夹给的是<b>读的权限</b>:需要时才去看,不会整个塞进上下文。<br />
          真正算上下文的,是你导入时留档的那些原件。
        </RailEmpty>
      ) : null}
      {typing || (!availability.canPick && !folder) ? (
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
          onClick={() => void revealPath(folder)}
          className="text-muted-foreground hover:text-foreground text-xs underline"
        >
          在访达中显示
        </button>
      ) : null}
      {!availability.canPick && !folder ? (
        <p className="text-muted-foreground mt-1 text-xs">{availability.reason}</p>
      ) : null}
      {error ? <p className="text-destructive mt-1 text-xs">{error}</p> : null}
    </RailSection>
  );
};

type ProjectContext = {
  folder: string | null;
  originals: Array<{ name: string; bytes: number; importedAt: string; seenCount: number }>;
  snapshots: Array<{ name: string; bytes: number; at: string }>;
  connectors: Array<{ server: string; tenant?: string; oldestLoadedAt: string; sheets: string[] }>;
};

const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

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
  const { closeWorkspace } = useSettingsPanel();
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
  // 搜索是**过滤已经在这儿的东西**,不是去后端再查一遍 —— 这一栏本来就是全量。
  const connectors = (data?.connectors ?? []).filter(
    (c) => hit(c.tenant ?? c.server) || c.sheets.some(hit),
  );
  const originals = (data?.originals ?? []).filter((f) => hit(f.name));
  const snapshots = (data?.snapshots ?? []).filter((f) => hit(f.name));
  const total = data
    ? data.connectors.length + data.originals.length + data.snapshots.length
    : 0;

  return (
    <RailSection
      title="上下文"
      {...(total > 0
        ? { action: { label: '全部', title: '打开上下文面板(搜索 + 预览)', onClick: () => setPanelOpen(true) } }
        : {})}
      {...(total === 0 ? {} : { hint: `${total} 项 · 对话里可以直接引用` })}
    >
      {total === 0 ? (
        // 空状态说清**放什么**,而不是整段消失 —— 消失的话人不知道这里可以放东西。
        <RailEmpty>导入表格、连上数据源,或给项目设一个文件夹,<br />之后在对话里就能直接引用。</RailEmpty>
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
      {panelOpen && data ? (
        <ContextPanel
          items={flattenContext(data)}
          projectId={project.id}
          onClose={() => setPanelOpen(false)}
          onOpenInPanel={(name) => {
            openDocument({ projectId: project.id, name });
            // 项目页是盖住全屏的:不让位,右侧那个 tab 打开了也看不见。
            closeWorkspace();
          }}
        />
      ) : null}

      {connectors.length > 0 ? (
        <div className="mb-2">
          <p className="text-muted-foreground mb-1 text-xs">连接器（会变，看刷新时间）</p>
          <ul className="space-y-1">
            {connectors.map((c) => (
              <li key={`${c.server}-${c.tenant ?? ''}`} className="flex items-baseline gap-2 text-xs">
                <span className="font-medium">{c.tenant ?? c.server}</span>
                <span className="text-muted-foreground min-w-0 flex-1 truncate">
                  {c.sheets.join('、')}
                </span>
                <span className="text-muted-foreground shrink-0">
                  {describeFreshness(c.oldestLoadedAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {originals.length > 0 || snapshots.length > 0 ? (
        <div>
          <p className="text-muted-foreground mb-1 text-xs">文件（存下来就不变）</p>
          <ul className="space-y-1">
            {originals.map((f) => (
              <li key={`o-${f.name}-${f.importedAt}`} className="flex items-baseline gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="text-muted-foreground shrink-0">
                  原件 · {kb(f.bytes)}
                  {f.seenCount > 1 ? ` · 用过 ${f.seenCount} 次` : ''}
                </span>
              </li>
            ))}
            {snapshots.map((f) => (
              <li key={`s-${f.name}`} className="flex items-baseline gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="text-muted-foreground shrink-0">快照 · {kb(f.bytes)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {/* 搜不到要说一声 —— 空白会被读成"这儿本来就没东西"。 */}
      {kw && connectors.length + originals.length + snapshots.length === 0 ? (
        <p className="text-muted-foreground text-xs">没有匹配「{q}」的项</p>
      ) : null}
    </RailSection>
  );
};

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
      <div className="text-muted-foreground mb-8 flex min-h-24 items-center justify-center">
        <LoaderIcon className="size-4 animate-spin" aria-label={t('projectPage.loading')} />
      </div>
    );
  }

  // No server exposes get_scene_card — the grid simply doesn't exist (normal
  // capability absence, not an error state).
  if (columns.length === 0) return null;

  // 眼前这批卡有多旧 + 一个手动刷新 —— 不定时轮询(用户定的规矩),但要能看出
  // 它是什么时候的,也要能自己叫它更新。
  const freshness = (
    <div className="text-muted-foreground mb-2 flex items-center gap-2 text-xs">
      <span>{at ? describeFreshness(at).replace('刷新', '更新') : '刚打开'}</span>
      <button
        type="button"
        onClick={refresh}
        disabled={revalidating}
        className="hover:text-foreground underline underline-offset-2 disabled:opacity-50"
      >
        {revalidating ? '核对中…' : '刷新'}
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
    <div className="mb-8">
      {freshness}
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
      >
      {entries.map((entry: SceneCardEntry) => (
        <SceneCardCell
          key={`${entry.source}::${entry.server}`}
          hostUrl={hostUrl}
          resourceUri={entry.resourceUri}
          server={entry.server}
          source={entry.source}
          projectId={project.id}
          fetched={entry.fetched}
          args={entry.args}
          argsKey={entry.argsKey}
        />
      ))}
      </div>
    </div>
  );
};

/** The project's thread bucket, reusing the sidebar's exact item rendering
 * (ThreadListPrimitive.ItemByIndex + ThreadListItem) and the same
 * triple-fallback pin keying as thread-list.tsx's partitionByProject.
 * Clicking a thread switches to it as usual; the wrapper's closeWorkspace
 * returns the main area to the chat view (same idiom as the sidebar's
 * SidebarContent onClick). */
const ProjectThreads: FC<{ projectId: string }> = ({ projectId }) => {
  const { t } = useTranslation();
  const { closeWorkspace } = useSettingsPanel();
  const threadIds = useAuiState((s) => s.threads.threadIds);
  const threadItems = useAuiState((s) => s.threads.threadItems);
  const threadProjects = useThreadProjects();
  const activity = useThreadActivityMap();

  const indices = useMemo(() => {
    const itemsById = new Map(threadItems.map((item) => [item.id, item]));
    const result: number[] = [];
    threadIds.forEach((id, index) => {
      const item = itemsById.get(id);
      // Triple fallback — see thread-list.tsx partitionByProject: the local id
      // of a brand-new thread later BECOMES its remoteId, so this resolves to
      // the key the pin was posted under.
      const key = item?.remoteId ?? item?.externalId ?? id;
      if (threadProjects[key] === projectId) result.push(index);
    });
    const time = (index: number) =>
      itemsById.get(threadIds[index]!)?.lastMessageAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    result.sort((a, b) => time(b) - time(a));
    return result;
  }, [threadIds, threadItems, threadProjects, projectId]);

  return (
    <section>
      <SectionHeading title={t('projectPage.threads')} count={indices.length} />
      <ThreadActivityContext.Provider value={activity}>
        <ThreadListPrimitive.Root
          className="aui-root flex flex-col gap-0.5"
          onClick={indices.length > 0 ? closeWorkspace : undefined}
        >
          {indices.length === 0 ? (
            <p className="text-muted-foreground text-sm italic">
              {t('threadList.emptyProject')}
            </p>
          ) : (
            indices.map((index) => (
              <ThreadListPrimitive.ItemByIndex
                key={threadIds[index]}
                index={index}
                components={{ ThreadListItem }}
              />
            ))
          )}
        </ThreadListPrimitive.Root>
      </ThreadActivityContext.Provider>
    </section>
  );
};
