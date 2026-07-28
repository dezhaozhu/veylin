import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type FC } from 'react';
import {
  McpAppRenderer,
  McpAppsRemoteHost,
  useAui,
} from '@assistant-ui/react';
import { useResource } from '@assistant-ui/tap';
import { LoaderIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { McpAppActionBridge } from '@/components/assistant-ui/mcp-app-action-bridge';
import { useSettingsPanel } from '@/hooks/settings/use-settings-panel';
import { placeComposerCaret } from '@/lib/composer-caret';
import { correctionDraftSpec, type CorrectionPayload } from '@/lib/correction-bridge';
import { projectSourceLabel } from '@/lib/project-labels';
import { postThreadProject, writeCachedThreadProject } from '@/lib/project-sync';
import { invalidateThreadProjects } from '@/lib/thread-projects-sync';
import { SCENE_CARD_TOOL, sceneCardArgs } from './scene-card-grid';

/**
 * One 项目首页 card cell: calls `get_scene_card` through the mcp-apps host
 * data plane (`POST /api/mcp-apps/host?projectId=…`, Task 5b) and renders the
 * returned widget through the SAME McpAppRenderer/McpAppsRemoteHost machinery
 * the chat inline widgets use (mcp-app-tool.tsx) — the host url carries
 * `projectId` instead of `threadId`, everything else is identical. The card's
 * content/density decisions live server-side inside the widget (compass's
 * scene-card.html); this cell only fetches and hosts it.
 *
 * The tool result is fetched once per mount — the page remounts on every view
 * open (AssistantChat renders the project view conditionally), which gives the
 * task's "refresh on view open; no polling" for free.
 */
export const SceneCardCell: FC<{
  hostUrl: string;
  /** ui:// resource declared by this server's get_scene_card (byServer map). */
  resourceUri: string;
  server: string;
  source: string;
  /** All of the project's sources — >1 ⇒ the call names its scene. */
  sources: readonly string[];
  /** The page's CURRENT project — the 修正桥's only possible target (host
   * context; the widget message never selects a project). */
  projectId: string;
}> = ({ hostUrl, resourceUri, server, source, sources, projectId }) => {
  const { t } = useTranslation();
  const args = useMemo(() => sceneCardArgs(sources, source), [sources, source]);
  const argsKey = JSON.stringify(args);

  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error' }
    | { status: 'ready'; result: unknown }
  >({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    fetch(hostUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: 'tools/call',
        params: { name: SCENE_CARD_TOOL, arguments: JSON.parse(argsKey) as Record<string, unknown> },
      }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as unknown;
      })
      .then((result) => {
        if (alive) setState({ status: 'ready', result });
      })
      .catch(() => {
        if (alive) setState({ status: 'error' });
      });
    return () => {
      alive = false;
    };
  }, [hostUrl, argsKey]);

  // Same host convention as mcp-app-tool.tsx's chat widgets; loadResource /
  // callTool / readResource from inside the widget go through the same
  // project-scoped route.
  const mcpHost = useMemo(() => McpAppsRemoteHost({ url: hostUrl }), [hostUrl]);
  const errorLine = (
    <div className="text-muted-foreground flex min-h-24 items-center px-3 text-sm">
      {t('projectPage.cardError')}
    </div>
  );
  const { render: Render } = useResource(
    McpAppRenderer({ host: mcpHost, fallback: errorLine }),
  );

  // 修正桥, 项目首页 context: the widget's "这里不对?" opens a NEW thread
  // pinned to the page's CURRENT project (this component's props — never the
  // message payload), navigates to chat and prefills the composer. Same
  // creation/pin sequence as project-list.tsx's new-chat-in-project. The
  // scene label is host-derived too: this cell's own `source`. Draft only;
  // nothing is auto-sent.
  const aui = useAui();
  const { closeWorkspace } = useSettingsPanel();
  const creatingRef = useRef(false);
  const handleCorrection = useCallback(
    (p: CorrectionPayload) => {
      if (creatingRef.current) return;
      creatingRef.current = true;
      void (async () => {
        try {
          await aui.threads().switchToNewThread();
          const item = aui.threads().item('main');
          const initialized = await item.initialize();
          // Triple fallback as in project-list.tsx — the local id later
          // BECOMES the remoteId, so the pin lands under the right key.
          const rid = initialized.remoteId ?? initialized.externalId ?? item.getState().id;
          const confirmed = await postThreadProject(rid, projectId);
          writeCachedThreadProject(rid, confirmed ?? projectId);
          invalidateThreadProjects();
          const spec = correctionDraftSpec(projectSourceLabel(source), p);
          const draft = t(spec.key, spec.vars);
          aui.composer().setText(draft);
          closeWorkspace();
          placeComposerCaret(draft.length);
        } catch (err) {
          console.error('[scene-card] open-correction failed:', err);
        } finally {
          creatingRef.current = false;
        }
      })();
    },
    [aui, projectId, source, t, closeWorkspace],
  );

  if (state.status === 'loading') {
    return (
      <div className="text-muted-foreground flex min-h-24 items-center justify-center">
        <LoaderIcon className="size-4 animate-spin" aria-label={t('projectPage.loading')} />
      </div>
    );
  }
  if (state.status === 'error') {
    return errorLine;
  }

  // Synthetic tool part — exactly the fields InlineRenderer reads: mcp.app
  // (which ui:// resource to mount), args/argsText/status (widget input),
  // result (widget output). Chat parts carry the same shape via the AI SDK.
  const part = {
    type: 'tool-call',
    toolCallId: `scene-card-${server}-${source || 'default'}`,
    toolName: SCENE_CARD_TOOL,
    args,
    argsText: argsKey,
    result: state.result,
    status: { type: 'complete' },
    mcp: { app: { resourceUri } },
  } as unknown as ComponentProps<typeof Render>;

  return (
    <McpAppActionBridge onCorrection={handleCorrection}>
      <Render {...part} />
    </McpAppActionBridge>
  );
};
