import { useEffect, useMemo, useState, type FC } from 'react';
import { ThreadListPrimitive, useAuiState } from '@assistant-ui/react';
import { LoaderIcon } from 'lucide-react';
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
import { useProjects, type ProjectInfo } from '@/lib/projects-sync';
import { useThreadProjects } from '@/lib/thread-projects-sync';
import { useThreadActivityMap } from '@/lib/use-thread-activity';
import { startWindowDrag } from '@/lib/window-drag';
import { SceneCardCell } from './scene-card-cell';
import { sceneCardColumns, type McpAppToolsByServer } from './scene-card-grid';

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
      <ProjectCardsGrid project={project} byServer={byServer} />
      <ProjectThreads projectId={project.id} />
    </div>
  );
};

const ProjectCardsGrid: FC<{
  project: ProjectInfo;
  byServer: McpAppToolsByServer | null;
}> = ({ project, byServer }) => {
  const { t } = useTranslation();
  const hostUrl = `/api/mcp-apps/host?projectId=${encodeURIComponent(project.id)}`;

  if (byServer === null) {
    return (
      <div className="text-muted-foreground mb-8 flex min-h-24 items-center justify-center">
        <LoaderIcon className="size-4 animate-spin" aria-label={t('projectPage.loading')} />
      </div>
    );
  }

  const columns = sceneCardColumns(byServer);
  // No server exposes get_scene_card — the grid simply doesn't exist (normal
  // capability absence, not an error state).
  if (columns.length === 0) return null;

  return (
    <div
      className="mb-8 grid gap-4"
      style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
    >
      {project.sources.map((source) =>
        columns.map((column) => (
          <SceneCardCell
            key={`${source}::${column.server}`}
            hostUrl={hostUrl}
            resourceUri={column.resourceUri}
            server={column.server}
            source={source}
            sources={project.sources}
            projectId={project.id}
          />
        )),
      )}
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
