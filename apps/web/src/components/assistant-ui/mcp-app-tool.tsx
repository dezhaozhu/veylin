import { useEffect, useMemo, useState } from 'react';
import {
  McpAppRenderer,
  McpAppsRemoteHost,
  useAuiState,
  type ToolCallMessagePartComponent,
} from '@assistant-ui/react';
import { useResource } from '@assistant-ui/tap';
import { ToolFallback } from '@/components/assistant-ui/tool-fallback';

// Data plane for MCP Apps: the sandboxed widget's loadResource/callTool/
// readResource requests are POSTed to the Veylin host route, which proxies to
// the tenant's MCP servers (e.g. Compass). `McpAppsRemoteHostOptions` only
// exposes `url`/`fetch`/`headers` (the POST body is a fixed `{ method,
// params }` shape) — so the current thread's id, needed by routes/mcp-apps.ts
// to enforce the thread's project pin, travels as a `?threadId=` query param
// on the url instead. Built per-thread (not module-scope) so it tracks thread
// switches.
function mcpHostUrl(threadId: string | undefined): string {
  return threadId ? `/api/mcp-apps/host?threadId=${encodeURIComponent(threadId)}` : '/api/mcp-apps/host';
}

// toolName → ui:// resource map, fetched from the server (derived from each
// tool's _meta.ui.resourceUri). mastra doesn't forward that metadata onto the
// AI SDK tool-call part, so we look it up by tool name and inject it — generic
// across any tool/server that declares an MCP App UI, no hardcoding. Cached
// per threadId — different threads can have different project-pin-scoped
// tool sets, see routes/mcp-apps.ts's resolveScopedServerNames.
const appToolsPromiseByThread = new Map<string, Promise<Record<string, string>>>();
function loadAppTools(threadId: string | undefined): Promise<Record<string, string>> {
  const key = threadId ?? '';
  let promise = appToolsPromiseByThread.get(key);
  if (!promise) {
    const url = threadId ? `/api/mcp-apps/tools?threadId=${encodeURIComponent(threadId)}` : '/api/mcp-apps/tools';
    promise = fetch(url)
      .then((r) => (r.ok ? r.json() : { tools: {} }))
      .then((d: { tools?: Record<string, string> }) => d.tools ?? {})
      .catch(() => ({}));
    appToolsPromiseByThread.set(key, promise);
  }
  return promise;
}

function useAppTools(threadId: string | undefined): Record<string, string> {
  const [map, setMap] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    loadAppTools(threadId).then((m) => {
      if (alive) setMap(m);
    });
    return () => {
      alive = false;
    };
  }, [threadId]);
  return map;
}

/**
 * Tool-call renderer with MCP Apps support. When a tool declares a `ui://`
 * resource (via `_meta.ui.resourceUri`), its UI renders inline in the
 * conversation (sandboxed iframe). Otherwise we fall back to the default
 * collapsible tool display. This is the host-side half of MCP Apps; the UI
 * itself is shipped by the MCP server (Compass = reference implementation).
 */
export const McpAppToolFallback: ToolCallMessagePartComponent = (props) => {
  // Same remoteId-first fallback used elsewhere for the server-side thread id
  // (composer-activated-skills.tsx, right-panel panels): the local composer id
  // until the thread's first message assigns a server remoteId/externalId.
  const localId = useAuiState((s) => s.threadListItem.id);
  const remoteId = useAuiState((s) => s.threadListItem.remoteId ?? s.threadListItem.externalId);
  const threadId = remoteId ?? localId ?? undefined;
  const appTools = useAppTools(threadId);
  const mcpHost = useMemo(() => McpAppsRemoteHost({ url: mcpHostUrl(threadId) }), [threadId]);
  const p = props as unknown as Record<string, unknown>;
  const uri = appTools[p.toolName as string];
  // getMcpAppFromToolPart (inside McpAppRenderer) reads the part's `.mcp.app`.
  // Inject it for tools that declare a ui:// resource so the app renders inline.
  const part = uri
    ? ({ ...p, mcp: { app: { resourceUri: uri } } } as unknown as typeof props)
    : props;
  const { render: Render } = useResource(
    McpAppRenderer({ host: mcpHost, fallback: <ToolFallback {...props} /> }),
  );
  return <Render {...part} />;
};
