/**
 * Remote MCP servers are configured per-tenant via the UI / workspace_config tool.
 * Bundled stdio servers have been removed.
 */
export interface StdioServerConfig {
  command: string;
  args: string[];
}

export const mcpServerConfigs: Record<string, StdioServerConfig> = {};
