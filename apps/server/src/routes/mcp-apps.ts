import type { FastifyInstance } from 'fastify';
import { MCPClient } from '@mastra/mcp';
import type { ServerDeps } from './types.js';
import { buildMcpServerConfigs, listActiveMcpServerNames, listMcpServerGroups } from '../mcp-store.js';
import { resolveScopedMcp } from '../mcp-scoping.js';
import { resolvePinnedProjectScope, type PinnedProjectScope } from '../project-store.js';
import { sceneSetKey } from '../compass-pool.js';
import { resolveThreadForRead } from '../thread-state.js';

/**
 * What resolveScopedServerNames hands the host's client builder (v3 re-key):
 * the classic allow-set PLUS the resolved project scope, so `freshClient` can
 * compose the compass entry's per-connection scene binding. `compassScope` is
 * non-null ONLY when a valid, enabled, tenant-owned project pin granted the
 * compass entry (in which case `allow` contains `compassScope.entryPin` by
 * construction) — every deny path returns `compassScope: null`, and without
 * it the client simply has no compass server at all (`buildMcpServerConfigs`
 * excludes the compass group, so there is no headerless fallback to reach).
 */
export type ScopedServerAccess = {
  allow: Set<string> | undefined;
  compassScope: PinnedProjectScope | null;
};

/** Injectable client factory (compass-pool deps style) — tests record `servers`. */
export type McpAppsClientFactory = (init: {
  id: string;
  servers: Record<string, unknown>;
}) => MCPClient;

const defaultClientFactory: McpAppsClientFactory = (init) =>
  new MCPClient({ id: init.id, servers: init.servers as never });

let hostSeq = 0;
// A per-request MCP client with a UNIQUE id. createMcpClient() uses a fixed id
// per tenant, and concurrent MCP-App requests (widget loadResource + callTool)
// would collide on it ("MCPClient initialized multiple times") → 500s. A unique
// id per request avoids the collision.
//
// `scoped.allow`, when given, restricts the client to that server subset —
// used to enforce a thread's project-pin scope (see resolveScopedServerNames
// below). Undefined means "no filtering" — only returned when the tenant has
// no grouped server at all (today's tenant-wide behavior, unchanged for those
// tenants). Once any server is grouped, a missing/unowned threadId scopes
// down instead of widening — see resolveScopedServerNames' doc comment.
//
// Compass (v3): the base configs NEVER contain the compass entry
// (`buildMcpServerConfigs` skips `COMPASS_IDENTITY_GROUP` so no generic
// client connects it headerless). When the request's project scope granted
// compass, its config is composed here — entry headers + the per-connection
// `x-compass-source` scene binding via `sceneSetKey`, the SAME single source
// of truth the compass pool uses for both its cache key and header, so this
// host's connection is byte-identical in binding to the pooled one.
// Exported for the header-composition seam test (no HTTP harness exists).
export async function freshClient(
  tenantId: string,
  scoped: ScopedServerAccess,
  createClient: McpAppsClientFactory = defaultClientFactory,
): Promise<MCPClient> {
  const servers = await buildMcpServerConfigs(tenantId);
  const scopedServers = scoped.allow
    ? Object.fromEntries(Object.entries(servers).filter(([name]) => scoped.allow!.has(name)))
    : servers;
  const { compassScope } = scoped;
  if (compassScope?.entry != null && compassScope.entryPin != null) {
    scopedServers[compassScope.entryPin] = {
      url: new URL(compassScope.entry.url),
      requestInit: {
        headers: {
          ...compassScope.entry.headers,
          'x-compass-source': sceneSetKey(compassScope.sources),
        },
      },
    };
  }
  hostSeq += 1;
  return createClient({
    id: `veylin-mcpapp-${tenantId}-${hostSeq}`,
    servers: scopedServers,
  });
}

/**
 * When `threadId` is given AND owned by the caller's tenant/user, resolve its
 * project pin and return the scoped active server-name set (pinned group
 * member + every ungrouped server) — the same enforcement chat.ts applies to
 * the agent's toolset, extended here to the mcp-apps host so a widget/
 * tool-call proxy can't reach a non-pinned group member.
 *
 * PROJECT-PIN RE-KEY (v3, Phase B 5b): the pin is a PROJECT id, translated
 * ONCE through the shared prelude `resolvePinnedProjectScope` into the
 * entry-level pin (`scope.entryPin` — the enabled compass entry's name, or
 * null for missing/foreign/disabled projects). The decision logic below then
 * runs verbatim on that entry-level pin, so every deny posture is unchanged:
 * a pin that doesn't resolve behaves exactly like the old stale-entry-name
 * pin. What's new is only WHICH connection backs a granted compass entry —
 * `compassScope` (sources + entry) lets `freshClient` compose the
 * scene-set-bound header.
 *
 * `projectId` (the 项目首页 data plane, plan Task 8): when present it takes
 * precedence over `threadId` and is validated through the SAME prelude —
 * tenant-owned + enabled, or it resolves to a null entry pin and falls into
 * the same deny branch as an unowned threadId (grouped denied, ungrouped
 * kept). Precedence cannot widen: an invalid projectId denies even when the
 * accompanying threadId carries a valid pin.
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
 * grouped server at all does a missing/unowned threadId return
 * `allow: undefined` ("no filtering") — byte-identical to today's behavior
 * for tenants that never configured grouping.
 */
export async function resolveScopedServerNames(
  tenantId: string,
  userId: string,
  threadId: string | undefined,
  projectId?: string,
): Promise<ScopedServerAccess> {
  const [activeNames, groups] = await Promise.all([
    listActiveMcpServerNames(tenantId),
    listMcpServerGroups(tenantId),
  ]);

  // Both deny branches below share this posture; compassScope is always null
  // on a deny — no scope, no scene binding, no compass config at all.
  const denyGrouped = (): ScopedServerAccess => {
    const hasGroupedServer = Object.values(groups).some((group) => group != null);
    if (!hasGroupedServer) return { allow: undefined, compassScope: null };
    return {
      allow: new Set(activeNames.filter((name) => groups[name] == null)),
      compassScope: null,
    };
  };

  let scope: PinnedProjectScope;
  if (projectId != null && projectId !== '') {
    // Project-page data plane: the projectId param IS the pin. The prelude
    // rejects missing/foreign/disabled ids with the all-null scope, which the
    // orphan branch below turns into the exact unowned-threadId deny.
    scope = await resolvePinnedProjectScope(tenantId, projectId);
  } else {
    // Resolves the owned row directly (not via the resolveThreadPin helper
    // other call sites use). Both "no owned thread" and "owned thread without
    // a valid pin" deny grouped servers — only a real, enabled project pin
    // opens its group member (deny-by-default; the chat path —
    // routes/chat.ts — agrees: it no longer auto-pins an unpinned thread
    // either, see that file's 全项目制 + 个人区 comment).
    const row = threadId ? await resolveThreadForRead(threadId, { tenantId, userId }) : null;
    if (!row) return denyGrouped();
    scope = await resolvePinnedProjectScope(tenantId, row.project ?? null);
  }

  const pin = scope.entryPin;
  const pinIsActiveGroupMember = pin != null && activeNames.includes(pin) && groups[pin] != null;
  if (!pinIsActiveGroupMember) {
    // Owned thread but NO (valid) pin — unpinned, or pinned to a project that
    // is missing/foreign/disabled (prelude resolved `entryPin: null`): this
    // widget proxy must not silently default to an arbitrary group member —
    // deny grouped servers until the thread actually has a valid pin (audit
    // posture: deny-by-default, review 2026-07-27 orphan-thread finding).
    // The chat path — routes/chat.ts — now denies the same way (its former
    // auto-pin-and-persist path was removed the same day; see 全项目制 +
    // 个人区).
    return denyGrouped();
  }
  const scoped = resolveScopedMcp(activeNames, groups, pin);
  return { allow: new Set(scoped.active), compassScope: scope };
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

/**
 * Collect the MCP-App tool → ui:// resource maps from a listToolsets result:
 * `tools` is the historical flat toolName-keyed map (kept for the chat
 * widget), `byServer` the additive server-keyed view the 项目首页 uses to lay
 * out card columns (a server with no UI-declaring tool simply has no key).
 * Pure and exported for the shape test — no HTTP harness exists in this repo.
 */
export function collectMcpAppTools(
  toolsets: Record<
    string,
    Record<string, { mcp?: { _meta?: { ui?: { resourceUri?: unknown } } } }>
  >,
): { tools: Record<string, string>; byServer: Record<string, Record<string, string>> } {
  const tools: Record<string, string> = {};
  const byServer: Record<string, Record<string, string>> = {};
  for (const server of Object.keys(toolsets)) {
    for (const [name, tool] of Object.entries(toolsets[server] ?? {})) {
      const uri = tool?.mcp?._meta?.ui?.resourceUri;
      if (typeof uri === 'string') {
        tools[name] = uri;
        (byServer[server] ??= {})[name] = uri;
      }
    }
  }
  return { tools, byServer };
}

export function registerMcpAppsRoutes(app: FastifyInstance, deps: ServerDeps): void {
  // toolName → ui:// resource map for every tool (across all servers) that
  // declares an MCP App UI. The web client uses this to know which tool calls
  // to render inline — no per-tool hardcoding. `projectId` (项目首页) scopes
  // by project instead of thread pin — see resolveScopedServerNames.
  app.get('/api/mcp-apps/tools', async (req) => {
    const ctx = await deps.resolveContext(req.headers);
    const { threadId, projectId } = (req.query ?? {}) as {
      threadId?: string;
      projectId?: string;
    };
    const scoped = await resolveScopedServerNames(ctx.tenantId, ctx.userId, threadId, projectId);
    const client = await freshClient(ctx.tenantId, scoped);
    try {
      const toolsets = (await client.listToolsets()) as Record<
        string,
        Record<string, { mcp?: { _meta?: { ui?: { resourceUri?: unknown } } } }>
      >;
      return collectMcpAppTools(toolsets);
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
    // threadId/projectId travel as query params, not the body:
    // `McpAppsRemoteHost` (the web client) POSTs a fixed `{ method, params }`
    // shape it doesn't let callers extend, so the client appends `?threadId=`
    // (chat widgets) or `?projectId=` (项目首页 cards) to the configured
    // `url` instead — mirrors GET /api/mcp-apps/tools above.
    const { threadId, projectId } = (req.query ?? {}) as {
      threadId?: string;
      projectId?: string;
    };
    const scoped = await resolveScopedServerNames(ctx.tenantId, ctx.userId, threadId, projectId);
    const client = await freshClient(ctx.tenantId, scoped);
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
