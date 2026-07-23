import type { FastifyInstance } from 'fastify';
import { MCPClient } from '@mastra/mcp';
import type { ServerDeps } from './types.js';
import { buildMcpServerConfigs, listActiveMcpServerNames, listMcpServerGroups } from '../mcp-store.js';
import { resolveScopedMcp } from '../mcp-scoping.js';
import { getThreadState, resolveThreadForRead } from '../thread-state.js';

let hostSeq = 0;
// A per-request MCP client with a UNIQUE id. createMcpClient() uses a fixed id
// per tenant, and concurrent MCP-App requests (widget loadResource + callTool)
// would collide on it ("MCPClient initialized multiple times") → 500s. A unique
// id per request avoids the collision.
//
// `allow`, when given, restricts the client to that server subset — used to
// enforce a thread's project-pin scope (see resolveScopedServerNames below).
// Undefined means "no filtering" — only returned when the tenant has no
// grouped server at all (today's tenant-wide behavior, unchanged for those
// tenants). Once any server is grouped, a missing/unowned threadId scopes
// down instead of widening — see resolveScopedServerNames' doc comment.
async function freshClient(tenantId: string, allow?: Set<string>): Promise<MCPClient> {
  const servers = await buildMcpServerConfigs(tenantId);
  const scopedServers = allow
    ? Object.fromEntries(Object.entries(servers).filter(([name]) => allow.has(name)))
    : servers;
  hostSeq += 1;
  return new MCPClient({
    id: `veylin-mcpapp-${tenantId}-${hostSeq}`,
    servers: scopedServers as never,
  });
}

/**
 * When `threadId` is given AND owned by the caller's tenant/user, resolve its
 * project pin and return the scoped active server-name set (pinned group
 * member + every ungrouped server) — the same enforcement chat.ts applies to
 * the agent's toolset, extended here to the mcp-apps host so a widget/
 * tool-call proxy can't reach a non-pinned group member.
 *
 * `threadId` is never trusted at face value: it's resolved through
 * `resolveThreadForRead`, the same ownership check the other query-param-
 * threadId routes (GET /api/tasks, /api/todos, /api/plan-mode, …) use. A
 * threadId that doesn't exist or belongs to another tenant/user is treated
 * exactly like a missing threadId — never a 500, and never a license to
 * borrow that thread's pin.
 *
 * A missing/unowned threadId does NOT widen to "no filtering" when the
 * tenant has any grouped server — that would let omitting threadId bypass
 * every project pin and reach the whole tenant. Instead it scopes to
 * UNGROUPED servers only (deny-by-default for grouped servers; ungrouped
 * servers are legitimately thread-independent). Only when the tenant has NO
 * grouped server at all does a missing/unowned threadId return `undefined`
 * ("no filtering") — byte-identical to today's behavior for tenants that
 * never configured grouping.
 */
export async function resolveScopedServerNames(
  tenantId: string,
  userId: string,
  threadId: string | undefined,
): Promise<Set<string> | undefined> {
  const [activeNames, groups] = await Promise.all([
    listActiveMcpServerNames(tenantId),
    listMcpServerGroups(tenantId),
  ]);

  let ownedThreadId: string | undefined;
  if (threadId) {
    const row = await resolveThreadForRead(threadId, { tenantId, userId });
    ownedThreadId = row ? threadId : undefined;
  }

  if (!ownedThreadId) {
    const hasGroupedServer = Object.values(groups).some((group) => group != null);
    if (!hasGroupedServer) return undefined;
    return new Set(activeNames.filter((name) => groups[name] == null));
  }

  const threadState = await getThreadState(ownedThreadId);
  const pin = threadState?.project ?? null;
  const scoped = resolveScopedMcp(activeNames, groups, pin);
  return new Set(scoped.active);
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
    const { threadId } = (req.query ?? {}) as { threadId?: string };
    const allow = await resolveScopedServerNames(ctx.tenantId, ctx.userId, threadId);
    const client = await freshClient(ctx.tenantId, allow);
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
    // threadId travels as a query param, not the body: `McpAppsRemoteHost`
    // (the web client) POSTs a fixed `{ method, params }` shape it doesn't let
    // callers extend, so the client appends `?threadId=` to the configured
    // `url` instead — mirrors GET /api/mcp-apps/tools below.
    const { threadId } = (req.query ?? {}) as { threadId?: string };
    const allow = await resolveScopedServerNames(ctx.tenantId, ctx.userId, threadId);
    const client = await freshClient(ctx.tenantId, allow);
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
          const toolsets = (await client.listToolsets()) as unknown as Record<
            string,
            Record<string, { execute: (a: { context: unknown }) => Promise<unknown> }>
          >;
          // Deterministic server precedence when >1 server exposes the same tool
          // name — alphabetical, not object-iteration order. When threadId
          // scoped this request, `client`/`toolsets` already only contains the
          // pinned group member + ungrouped servers, so this also means the
          // pinned server wins over any non-pinned group member by construction.
          for (const server of Object.keys(toolsets).sort((a, b) => a.localeCompare(b))) {
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
