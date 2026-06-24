/**
 * Client-side helper config for connecting to the bundled MCP servers via @mastra/mcp.
 * Usage in the runtime:
 *   const mcp = new MCPClient({ servers: mcpServerConfigs });
 *   const tools = await mcp.getTools();
 *
 * Production (Tauri sidecar): the build step emits `<name>-server.mjs` next to the
 * bundled `server.mjs`; we launch them with the embedded Node (`process.execPath`).
 * Dev: fall back to running the TypeScript source with `tsx`.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface StdioServerConfig {
  command: string;
  args: string[];
}

function resolveServer(name: string): StdioServerConfig {
  const compiled = fileURLToPath(new URL(`./${name}.mjs`, import.meta.url));
  if (existsSync(compiled)) {
    return { command: process.execPath, args: [compiled] };
  }
  const source = fileURLToPath(new URL(`./${name}.ts`, import.meta.url));
  return { command: 'tsx', args: [source] };
}

export const mcpServerConfigs: Record<string, StdioServerConfig> = {
  scheduling: resolveServer('scheduling-server'),
  maintenance: resolveServer('maintenance-server'),
};
