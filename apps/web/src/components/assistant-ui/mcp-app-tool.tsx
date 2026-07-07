import { useEffect, useState } from 'react';
import {
  McpAppRenderer,
  McpAppsRemoteHost,
  type ToolCallMessagePartComponent,
} from '@assistant-ui/react';
import { useResource } from '@assistant-ui/tap';
import { ToolFallback } from '@/components/assistant-ui/tool-fallback';

// Data plane for MCP Apps: the sandboxed widget's loadResource/callTool/
// readResource requests are POSTed to this Veylin route, which proxies to the
// tenant's MCP servers (e.g. Compass). One shared host for all app tools.
const mcpHost = McpAppsRemoteHost({ url: '/api/mcp-apps/host' });

// toolName → ui:// resource map, fetched once from the server (derived from each
// tool's _meta.ui.resourceUri). mastra doesn't forward that metadata onto the
// AI SDK tool-call part, so we look it up by tool name and inject it — generic
// across any tool/server that declares an MCP App UI, no hardcoding.
let appToolsPromise: Promise<Record<string, string>> | null = null;
function loadAppTools(): Promise<Record<string, string>> {
  if (!appToolsPromise) {
    appToolsPromise = fetch('/api/mcp-apps/tools')
      .then((r) => (r.ok ? r.json() : { tools: {} }))
      .then((d: { tools?: Record<string, string> }) => d.tools ?? {})
      .catch(() => ({}));
  }
  return appToolsPromise;
}

function useAppTools(): Record<string, string> {
  const [map, setMap] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    loadAppTools().then((m) => {
      if (alive) setMap(m);
    });
    return () => {
      alive = false;
    };
  }, []);
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
  const appTools = useAppTools();
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
