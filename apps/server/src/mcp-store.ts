import { MCPClient } from '@mastra/mcp';
import {
  deleteMcpServerRow,
  insertMcpServer,
  listMcpServerRows,
  updateMcpServerRow,
} from '@veylin/db';
import { mcpServerConfigs } from '@veylin/mcp-servers';
import { mcpServerInputSchema, type McpServer, type McpServerInput } from '@veylin/shared';
import { getDisabledMcpServers } from './skills-store';

export type McpServerConfig = Record<string, unknown>;

function rowToMcp(row: Awaited<ReturnType<typeof listMcpServerRows>>[number]): McpServer {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    transport: row.transport,
    url: row.url,
    headers: row.headers ?? {},
    enabled: row.enabled,
    createdAt: row.createdAt,
  };
}

export async function listRemoteMcpServers(tenantId: string): Promise<McpServer[]> {
  const rows = await listMcpServerRows(tenantId);
  return rows.map(rowToMcp);
}

export async function createRemoteMcpServer(tenantId: string, input: McpServerInput) {
  const row = await insertMcpServer(tenantId, {
    name: input.name.trim(),
    transport: input.transport,
    url: input.url,
    headers: input.headers ?? {},
    enabled: input.enabled ?? true,
  });
  return rowToMcp(row);
}

export async function updateRemoteMcpServer(
  tenantId: string,
  id: string,
  patch: Partial<McpServerInput>,
) {
  const row = await updateMcpServerRow(tenantId, id, {
    ...(patch.name != null ? { name: patch.name.trim() } : {}),
    ...(patch.transport != null ? { transport: patch.transport } : {}),
    ...(patch.url != null ? { url: patch.url } : {}),
    ...(patch.headers != null ? { headers: patch.headers } : {}),
    ...(patch.enabled != null ? { enabled: patch.enabled } : {}),
  });
  return row ? rowToMcp(row) : null;
}

export async function deleteRemoteMcpServer(tenantId: string, id: string): Promise<boolean> {
  return deleteMcpServerRow(tenantId, id);
}

/** Parse VEYLIN_MCP_SERVERS JSON array from env (dev/bootstrap). */
export function parseMcpServersFromEnv(
  raw = process.env.VEYLIN_MCP_SERVERS?.trim() ?? '',
): McpServerInput[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      console.warn('[veylin] VEYLIN_MCP_SERVERS must be a JSON array; skipping MCP seed');
      return [];
    }
    const out: McpServerInput[] = [];
    for (const item of parsed) {
      const result = mcpServerInputSchema.safeParse(item);
      if (result.success) out.push(result.data);
      else console.warn('[veylin] skipping invalid VEYLIN_MCP_SERVERS entry:', result.error.message);
    }
    return out;
  } catch {
    console.warn('[veylin] VEYLIN_MCP_SERVERS is not valid JSON; skipping MCP seed');
    return [];
  }
}

/** Insert env-declared MCP servers when missing from DB (by name). */
export async function seedMcpServersFromEnvIfMissing(tenantId: string): Promise<number> {
  const fromEnv = parseMcpServersFromEnv();
  if (fromEnv.length === 0) return 0;

  const existing = await listRemoteMcpServers(tenantId);
  const existingNames = new Set(existing.map((s) => s.name));
  let seeded = 0;
  for (const input of fromEnv) {
    const name = input.name.trim();
    if (existingNames.has(name)) continue;
    await createRemoteMcpServer(tenantId, input);
    existingNames.add(name);
    seeded += 1;
  }
  if (seeded > 0) {
    console.info(`[veylin] seeded ${seeded} MCP server(s) from VEYLIN_MCP_SERVERS`);
  }
  return seeded;
}

export async function buildMcpServerConfigs(tenantId: string): Promise<McpServerConfig> {
  const remote = await listRemoteMcpServers(tenantId);
  const active = new Set(await listActiveMcpServerNames(tenantId));
  const configs: McpServerConfig = {};

  for (const [name, config] of Object.entries(mcpServerConfigs)) {
    if (active.has(name)) configs[name] = config;
  }

  for (const server of remote) {
    if (!active.has(server.name)) continue;
    configs[server.name] = {
      url: new URL(server.url),
      ...(Object.keys(server.headers).length > 0 ? { requestInit: { headers: server.headers } } : {}),
    };
  }
  return configs;
}

export async function createMcpClient(
  tenantId: string,
  scope: 'server' | 'run' = 'server',
): Promise<MCPClient> {
  const servers = await buildMcpServerConfigs(tenantId);
  return new MCPClient({
    id: `veylin-mcp-${scope}-${tenantId}`,
    servers: servers as never,
  });
}

export function listBundledMcpServerNames(): string[] {
  return Object.keys(mcpServerConfigs);
}

export async function listActiveMcpServerNames(
  tenantId: string,
  declaredMcp: string[] = [],
): Promise<string[]> {
  const disabledBundled = new Set(await getDisabledMcpServers(tenantId));
  const remote = await listRemoteMcpServers(tenantId);
  const disabledRemote = new Set(remote.filter((s) => !s.enabled).map((s) => s.name));
  const candidates =
    declaredMcp.length > 0 ? declaredMcp : remote.map((s) => s.name);
  return [...new Set(candidates.filter((s) => !disabledBundled.has(s) && !disabledRemote.has(s)))];
}
