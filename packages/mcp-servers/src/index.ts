/**
 * Remote MCP servers are configured via ~/.veylin/mcp.json (and Settings UI).
 * Plugin stdio servers come from enabled plugins' `.mcp.json`.
 * Bundled stdio servers have been removed.
 */
export interface StdioServerConfig {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export const mcpServerConfigs: Record<string, StdioServerConfig> = {};
