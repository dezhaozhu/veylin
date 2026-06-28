export type McpServerHealth = {
  name: string;
  connected: boolean;
  toolCount: number;
  lastError?: string;
};

export type McpHealthSnapshot = {
  lastError?: string;
  servers: McpServerHealth[];
};

export function buildMcpHealthSnapshot(
  activeNames: string[],
  toolsets: Record<string, unknown>,
  listError?: string,
): McpHealthSnapshot {
  const servers = activeNames.map((name) => {
    const tools = toolsets[name];
    const connected = tools != null && typeof tools === 'object';
    return {
      name,
      connected,
      toolCount:
        connected && typeof tools === 'object'
          ? Object.keys(tools as Record<string, unknown>).length
          : 0,
      lastError: !connected && listError ? listError : undefined,
    };
  });
  return { lastError: listError, servers };
}
