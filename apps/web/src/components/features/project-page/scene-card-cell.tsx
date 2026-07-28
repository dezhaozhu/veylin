import { useEffect, useMemo, useState, type ComponentProps, type FC } from 'react';
import {
  McpAppRenderer,
  McpAppsRemoteHost,
} from '@assistant-ui/react';
import { useResource } from '@assistant-ui/tap';
import { LoaderIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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
}> = ({ hostUrl, resourceUri, server, source, sources }) => {
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

  return <Render {...part} />;
};
