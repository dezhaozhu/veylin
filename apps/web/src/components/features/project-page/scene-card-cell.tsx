import { useCallback, useMemo, type ComponentProps, type FC } from 'react';
import { McpAppRenderer, McpAppsRemoteHost } from '@assistant-ui/react';
import { useResource } from '@assistant-ui/tap';
import { useTranslation } from 'react-i18next';
import { McpAppActionBridge } from '@/components/assistant-ui/mcp-app-action-bridge';
import type { CorrectionPayload } from '@/lib/correction-bridge';
import { SCENE_CARD_TOOL } from './scene-card-grid';
import { useOpenCorrection } from './use-open-correction';
import type { SceneCardFetch } from './use-scene-card-payloads';

/**
 * One 项目首页 card cell: renders an ALREADY-FETCHED `get_scene_card` result
 * through the SAME McpAppRenderer/McpAppsRemoteHost machinery the chat inline
 * widgets use (mcp-app-tool.tsx) — the host url carries `projectId` instead of
 * `threadId`, everything else is identical. The card's content/density
 * decisions live server-side inside the widget (compass's scene-card.html);
 * this cell only hosts it.
 *
 * The fetch itself moved up to `useSceneCardPayloads` (Phase 4): the page must
 * see every card's payload at once to choose between the merged comparison
 * table and these side-by-side cells. Still one fetch per view open, no
 * polling — the page is conditionally mounted.
 */

export const SceneCardCell: FC<{
  hostUrl: string;
  /** ui:// resource declared by this server's get_scene_card (byServer map). */
  resourceUri: string;
  server: string;
  source: string;
  /** The page's CURRENT project — the 修正桥's only possible target (host
   * context; the widget message never selects a project). */
  projectId: string;
  /** This cell's already-settled payload (from useSceneCardPayloads). */
  fetched: SceneCardFetch;
  /** The arguments the payload was fetched with — passed straight to the
   * widget as its tool input. */
  args: Record<string, unknown>;
  argsKey: string;
}> = ({ hostUrl, resourceUri, server, source, projectId, fetched, args, argsKey }) => {
  const { t } = useTranslation();

  // Same host convention as mcp-app-tool.tsx's chat widgets; loadResource /
  // callTool / readResource from inside the widget go through the same
  // project-scoped route.
  const mcpHost = useMemo(() => McpAppsRemoteHost({ url: hostUrl }), [hostUrl]);
  const errorLine = (
    <div className="text-muted-foreground flex min-h-24 items-center px-3 text-sm">
      {t('projectPage.cardError')}
    </div>
  );
  // Project homepage cards need room for multi-section scene content; chat
  // inline widgets stay compact. Floor the iframe even when the widget's size
  // notification is late/small (common when compass MCP is slow).
  const { render: Render } = useResource(
    McpAppRenderer({ host: mcpHost, fallback: errorLine, maxHeight: 1200 }),
  );

  // 修正桥, 项目首页 context: the widget's "这里不对?" opens a NEW thread
  // pinned to the page's CURRENT project (this component's props — never the
  // message payload), navigates to chat and prefills the composer. The
  // sequence itself lives in useOpenCorrection, shared with the 对比合并视图
  // table so BOTH card shapes offer the same one-click correction path (and
  // share its single module-scoped in-flight guard). The scene label is
  // host-derived here too: this cell's own `source`.
  const openCorrection = useOpenCorrection(projectId);
  const handleCorrection = useCallback(
    (p: CorrectionPayload) => openCorrection(source, p),
    [openCorrection, source],
  );

  if (fetched.status === 'error') {
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
    result: fetched.result,
    status: { type: 'complete' },
    mcp: { app: { resourceUri } },
  } as unknown as ComponentProps<typeof Render>;

  return (
    <McpAppActionBridge onCorrection={handleCorrection}>
      <div className="min-h-[320px] w-full [&_iframe]:min-h-[320px]">
        <Render {...part} />
      </div>
    </McpAppActionBridge>
  );
};
