import { promises as fs } from 'node:fs';
import { MCPClient } from '@mastra/mcp';
import { listMcpServerRows } from '@veylin/db';
import { mcpServerConfigs } from '@veylin/mcp-servers';
import { mcpServerInputSchema, type McpServer, type McpServerInput } from '@veylin/shared';
import { getDisabledMcpServers } from './veylin-settings-file.js';
import { veylinHome, veylinMcpLocalPath, veylinMcpPath } from './veylin-paths.js';

export type McpServerConfig = Record<string, unknown>;

type McpFileEntry = {
  transport: 'sse' | 'http';
  url: string;
  enabled?: boolean;
  headers?: Record<string, string>;
};

type McpFile = {
  mcpServers: Record<string, McpFileEntry>;
};

let mcpMigrated = false;

async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

async function writeMcpPublic(file: McpFile): Promise<void> {
  await fs.mkdir(veylinHome(), { recursive: true });
  const publicServers: Record<string, McpFileEntry> = {};
  for (const [name, entry] of Object.entries(file.mcpServers)) {
    publicServers[name] = {
      transport: entry.transport,
      url: entry.url,
      enabled: entry.enabled !== false,
    };
  }
  await fs.writeFile(
    veylinMcpPath(),
    `${JSON.stringify({ mcpServers: publicServers }, null, 2)}\n`,
    'utf8',
  );
}

async function writeMcpLocal(headersByName: Record<string, Record<string, string>>): Promise<void> {
  await fs.mkdir(veylinHome(), { recursive: true });
  const mcpServers: Record<string, { headers: Record<string, string> }> = {};
  for (const [name, headers] of Object.entries(headersByName)) {
    if (Object.keys(headers).length > 0) mcpServers[name] = { headers };
  }
  await fs.writeFile(
    veylinMcpLocalPath(),
    `${JSON.stringify({ mcpServers }, null, 2)}\n`,
    'utf8',
  );
}

async function loadMergedMcpFile(): Promise<McpFile> {
  const pub = await readJsonFile<McpFile>(veylinMcpPath(), { mcpServers: {} });
  const local = await readJsonFile<{
    mcpServers?: Record<string, { headers?: Record<string, string> }>;
  }>(veylinMcpLocalPath(), { mcpServers: {} });
  const mcpServers: Record<string, McpFileEntry> = { ...(pub.mcpServers ?? {}) };
  for (const [name, entry] of Object.entries(local.mcpServers ?? {})) {
    const base = mcpServers[name] ?? { transport: 'http' as const, url: '', enabled: true };
    mcpServers[name] = {
      ...base,
      headers: { ...(base.headers ?? {}), ...(entry.headers ?? {}) },
    };
  }
  return { mcpServers };
}

async function persistMerged(file: McpFile): Promise<void> {
  const headersByName: Record<string, Record<string, string>> = {};
  for (const [name, entry] of Object.entries(file.mcpServers)) {
    if (entry.headers && Object.keys(entry.headers).length > 0) {
      headersByName[name] = entry.headers;
    }
  }
  await writeMcpPublic(file);
  await writeMcpLocal(headersByName);
}

async function migrateMcpFromDb(tenantId: string): Promise<void> {
  if (mcpMigrated) return;
  mcpMigrated = true;
  try {
    await fs.access(veylinMcpPath());
    return;
  } catch {
    // missing
  }
  try {
    const rows = await listMcpServerRows(tenantId);
    if (rows.length === 0) {
      await persistMerged({ mcpServers: {} });
      return;
    }
    const mcpServers: Record<string, McpFileEntry> = {};
    for (const row of rows) {
      mcpServers[row.name] = {
        transport: row.transport as 'sse' | 'http',
        url: row.url,
        enabled: row.enabled,
        headers: row.headers ?? {},
      };
    }
    await persistMerged({ mcpServers });
    console.info(`[veylin] migrated ${rows.length} MCP server(s) to mcp.json`);
  } catch (err) {
    console.warn('[veylin] mcp.json migration skipped:', err);
    await persistMerged({ mcpServers: {} });
  }
}

function entryToServer(tenantId: string, name: string, entry: McpFileEntry): McpServer {
  return {
    id: name,
    tenantId,
    name,
    transport: entry.transport,
    url: entry.url,
    headers: entry.headers ?? {},
    enabled: entry.enabled !== false,
  };
}

export async function listRemoteMcpServers(tenantId: string): Promise<McpServer[]> {
  await migrateMcpFromDb(tenantId);
  const file = await loadMergedMcpFile();
  return Object.entries(file.mcpServers)
    .filter(([, e]) => e.url)
    .map(([name, entry]) => entryToServer(tenantId, name, entry))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function createRemoteMcpServer(tenantId: string, input: McpServerInput) {
  await migrateMcpFromDb(tenantId);
  const name = input.name.trim();
  const file = await loadMergedMcpFile();
  if (file.mcpServers[name]) throw new Error(`MCP server already exists: ${name}`);
  file.mcpServers[name] = {
    transport: input.transport,
    url: input.url,
    headers: input.headers ?? {},
    enabled: input.enabled ?? true,
  };
  await persistMerged(file);
  return entryToServer(tenantId, name, file.mcpServers[name]!);
}

export async function updateRemoteMcpServer(
  tenantId: string,
  id: string,
  patch: Partial<McpServerInput>,
) {
  await migrateMcpFromDb(tenantId);
  const file = await loadMergedMcpFile();
  const existing = file.mcpServers[id];
  if (!existing) return null;
  const nextName = patch.name?.trim() || id;
  const next: McpFileEntry = {
    transport: patch.transport ?? existing.transport,
    url: patch.url ?? existing.url,
    headers: patch.headers ?? existing.headers ?? {},
    enabled: patch.enabled ?? existing.enabled !== false,
  };
  delete file.mcpServers[id];
  file.mcpServers[nextName] = next;
  await persistMerged(file);
  return entryToServer(tenantId, nextName, next);
}

export async function deleteRemoteMcpServer(tenantId: string, id: string): Promise<boolean> {
  await migrateMcpFromDb(tenantId);
  const file = await loadMergedMcpFile();
  if (!file.mcpServers[id]) return false;
  delete file.mcpServers[id];
  await persistMerged(file);
  return true;
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

/** Insert env-declared MCP servers when missing from file (by name). */
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
