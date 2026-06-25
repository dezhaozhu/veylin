import { MCPClient } from '@mastra/mcp';
import {
  deleteMcpServerRow,
  insertMcpServer,
  listMcpServerRows,
  updateMcpServerRow,
} from '@veylin/db';
import { mcpServerConfigs } from '@veylin/mcp-servers';
import type { McpServer, McpServerInput } from '@veylin/shared';
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

export async function createMcpClient(tenantId: string): Promise<MCPClient> {
  const servers = await buildMcpServerConfigs(tenantId);
  return new MCPClient({ servers: servers as never });
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
