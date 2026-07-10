/**
 * Remote MCP servers are configured via ~/.veylin/mcp.json (and Settings UI).
 * Bundled stdio servers have been removed.
 */
export interface StdioServerConfig {
  command: string;
  args: string[];
}

export const mcpServerConfigs: Record<string, StdioServerConfig> = {};
