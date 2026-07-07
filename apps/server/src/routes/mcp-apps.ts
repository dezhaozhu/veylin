import type { FastifyInstance } from 'fastify';
import { MCPClient } from '@mastra/mcp';
import type { ServerDeps } from './types.js';
import { buildMcpServerConfigs } from '../mcp-store.js';

let hostSeq = 0;
// A per-request MCP client with a UNIQUE id. createMcpClient() uses a fixed id
// per tenant, and concurrent MCP-App requests (widget loadResource + callTool)
// would collide on it ("MCPClient initialized multiple times") → 500s. A unique
// id per request avoids the collision.
async function freshClient(tenantId: string): Promise<MCPClient> {
  const servers = await buildMcpServerConfigs(tenantId);
  hostSeq += 1;
  return new MCPClient({ id: `veylin-mcpapp-${tenantId}-${hostSeq}`, servers: servers as never });
}

// MCP Apps host data-plane. `McpAppsRemoteHost({ url })` in the web app POSTs
// { method, params } here and expects JSON. We proxy to the tenant's MCP
// servers (e.g. Compass) so a tool's ui:// resource + tool calls resolve. The
// UI resource (served by the MCP server) renders inline in the conversation.
const MCP_APP_MIME = 'text/html;profile=mcp-app';

// Pull the html text out of an MCP readResource result. @mastra/mcp returns a
// standard { contents: [{ uri, mimeType, text }] }; be tolerant of shape.
function extractHtml(result: unknown): { uri?: string; html: string; mimeType?: string } | null {
  const r = result as Record<string, unknown> | undefined;
  const raw = (r?.contents ?? r?.content ?? r) as unknown;
  const arr = Array.isArray(raw) ? raw : [raw];
  for (const c of arr) {
    const item = c as Record<string, unknown> | undefined;
    if (item && typeof item.text === 'string') {
      return {
        uri: typeof item.uri === 'string' ? item.uri : undefined,
        html: item.text,
        mimeType: typeof item.mimeType === 'string' ? item.mimeType : undefined,
      };
    }
  }
  return null;
}

export function registerMcpAppsRoutes(app: FastifyInstance, deps: ServerDeps): void {
  // toolName → ui:// resource map for every tool (across all servers) that
  // declares an MCP App UI. The web client uses this to know which tool calls
  // to render inline — no per-tool hardcoding.
  app.get('/api/mcp-apps/tools', async (req) => {
    const ctx = await deps.resolveContext(req.headers);
    const client = await freshClient(ctx.tenantId);
    try {
      const toolsets = (await client.listToolsets()) as Record<
        string,
        Record<string, { mcp?: { _meta?: { ui?: { resourceUri?: unknown } } } }>
      >;
      const tools: Record<string, string> = {};
      for (const server of Object.keys(toolsets)) {
        for (const [name, tool] of Object.entries(toolsets[server] ?? {})) {
          const uri = tool?.mcp?._meta?.ui?.resourceUri;
          if (typeof uri === 'string') tools[name] = uri;
        }
      }
      return { tools };
    } finally {
      try {
        await client.disconnect();
      } catch {
        /* best-effort */
      }
    }
  });

  app.post('/api/mcp-apps/host', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const { method, params } = (req.body ?? {}) as {
      method?: string;
      params?: { uri?: string; name?: string; arguments?: Record<string, unknown> };
    };
    const client = await freshClient(ctx.tenantId);
    try {
      switch (method) {
        case 'mcp-apps/read-resource':
        case 'resources/read': {
          const uri = params?.uri;
          if (!uri) return reply.code(400).send({ error: 'missing uri' });
          // resources.read takes (serverName, uri); find which server serves the
          // uri from the per-server list so we don't hardcode a server name.
          const listed = (await client.resources.list()) as Record<
            string,
            Array<{ uri?: string }>
          >;
          const server = Object.keys(listed).find((s) =>
            (listed[s] ?? []).some((r) => r.uri === uri),
          );
          if (!server) return reply.code(404).send({ error: `no server serves ${uri}` });
          const result = await client.resources.read(server, uri);
          const html = extractHtml(result);
          if (!html) return reply.code(404).send({ error: 'resource has no html body' });
          return { uri: html.uri ?? uri, mimeType: MCP_APP_MIME, html: html.html };
        }
        case 'resources/list':
          return await client.resources.list();
        case 'tools/call': {
          const name = params?.name;
          if (!name) return reply.code(400).send({ error: 'missing tool name' });
          const toolsets = (await client.listToolsets()) as Record<
            string,
            Record<string, { execute: (a: { context: unknown }) => Promise<unknown> }>
          >;
          for (const server of Object.keys(toolsets)) {
            const tool = toolsets[server]?.[name];
            if (tool) return await tool.execute({ context: params?.arguments ?? {} });
          }
          return reply.code(404).send({ error: `tool not found: ${name}` });
        }
        default:
          return reply.code(400).send({ error: `unknown method: ${method ?? '(none)'}` });
      }
    } finally {
      try {
        await client.disconnect();
      } catch {
        /* best-effort */
      }
    }
  });
}
