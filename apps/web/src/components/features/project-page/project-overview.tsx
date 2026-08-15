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
import { useSettingsPanel } from '@/hooks/settings/use-settings-panel';
import { projectSourceLabel } from '@/lib/project-labels';
import { setProjectFolder, useProjects, type ProjectInfo } from '@/lib/projects-sync';
import {
  describeFolderState,
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

  return (
    <div className="mx-auto flex max-w-4xl flex-col">
      <PageHeader
        title={project.name}
        description={project.sources.map(projectSourceLabel).join(' · ')}
      />
      <ProjectFolderRow project={project} />
      <ProjectContextSection project={project} />
      <ProjectCardsGrid project={project} byServer={byServer} />
      <ProjectThreads projectId={project.id} />
    </div>
  );
};

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
  const [typed, setTyped] = useState('');
  const [picking, setPicking] = useState(false);
  const availability = folderPickAvailability();

  useEffect(() => { setFolder(project.folder); }, [project.folder]);

  const bind = async (path: string) => {
    const clean = normalizeTypedPath(path);
    if (!clean) return;
    const res = await setProjectFolder(project.id, clean);
    if (res.ok) {
      setFolder(res.project.folder);
      setTyped('');
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
      else if (out.status === 'timeout') setError('系统选择框没有响应 —— 把路径粘到下面就行。');
      else if (out.status === 'unavailable') setError('打不开系统选择框 —— 把路径粘到下面就行。');
    } finally {
      setPicking(false);
    }
  };

  return (
    <section className="border-border mb-4 rounded-md border px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <FolderOpen className="text-muted-foreground size-4 shrink-0" />
        <span className="text-muted-foreground min-w-0 flex-1 truncate">
          {describeFolderState(folder)}
        </span>
        {availability.canPick ? (
          <button
            type="button"
            onClick={() => void choose()}
            disabled={picking}
            className="hover:bg-muted shrink-0 rounded-md border px-2 py-1 text-xs disabled:opacity-50"
          >
            {picking ? '选择中…' : folder ? '换一个' : '浏览…'}
          </button>
        ) : null}
        {folder ? (
          <button
            type="button"
            onClick={() => void revealPath(folder)}
            className="hover:bg-muted shrink-0 rounded-md border px-2 py-1 text-xs"
          >
            在访达中显示
          </button>
        ) : null}
      </div>
      {/* 永远留一条不依赖原生面板的路:把路径粘进来(访达 ⌘⌥C 复制路径)。 */}
      <div className="mt-2 flex items-center gap-2">
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void bind(typed); }}
          placeholder="或者把文件夹路径粘到这里，回车"
          className="border-border bg-background min-w-0 flex-1 rounded-md border px-2 py-1 text-xs"
        />
        <button
          type="button"
          onClick={() => void bind(typed)}
          disabled={!normalizeTypedPath(typed)}
          className="hover:bg-muted shrink-0 rounded-md border px-2 py-1 text-xs disabled:opacity-40"
        >
          使用
        </button>
      </div>
      {!availability.canPick ? (
        <p className="text-muted-foreground mt-1 text-xs">{availability.reason}</p>
      ) : null}
      {error ? <p className="text-destructive mt-1 text-xs">{error}</p> : null}
    </section>
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
const ProjectContextSection: FC<{ project: ProjectInfo }> = ({ project }) => {
  const [data, setData] = useState<ProjectContext | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/project/context');
        const body = (await res.json()) as { ok?: boolean } & ProjectContext;
        if (!cancelled && body.ok) setData(body);
      } catch {
        /* 读不到就不显示这一栏 —— 它是陈述,不该报错打断人 */
      }
    })();
    return () => { cancelled = true; };
  }, [project.id, project.folder]);

  if (!data) return null;
  const nothing =
    data.originals.length === 0 && data.snapshots.length === 0 && data.connectors.length === 0;
  if (nothing) return null;

  return (
    <section className="border-border mb-4 rounded-md border px-3 py-2 text-sm">
      <h3 className="text-muted-foreground mb-2 text-xs uppercase tracking-wide">Context</h3>

      {data.connectors.length > 0 ? (
        <div className="mb-2">
          <p className="text-muted-foreground mb-1 text-xs">连接器（会变，看刷新时间）</p>
          <ul className="space-y-1">
            {data.connectors.map((c) => (
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

      {data.originals.length > 0 || data.snapshots.length > 0 ? (
        <div>
          <p className="text-muted-foreground mb-1 text-xs">文件（存下来就不变）</p>
          <ul className="space-y-1">
            {data.originals.map((f) => (
              <li key={`o-${f.name}-${f.importedAt}`} className="flex items-baseline gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="text-muted-foreground shrink-0">
                  原件 · {kb(f.bytes)}
                  {f.seenCount > 1 ? ` · 用过 ${f.seenCount} 次` : ''}
                </span>
              </li>
            ))}
            {data.snapshots.map((f) => (
              <li key={`s-${f.name}`} className="flex items-baseline gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="text-muted-foreground shrink-0">快照 · {kb(f.bytes)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
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
  const entries = useSceneCardPayloads(hostUrl, columns, project.sources);

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
      <SceneCardMergeTable
        scenes={candidates.map((c) => ({ source: c.source, rows: c.rows! }))}
        serverLabels={
          servers.size > 1 ? entries.map((e) => e.server) : undefined
        }
        narratives={narratives}
        projectId={project.id}
      />
    );
  }

  return (
    <div
      className="mb-8 grid gap-4"
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
