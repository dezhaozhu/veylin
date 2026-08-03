/**
 * Filter MCP + task toolsets for dynamic-discovery agents (no explicit tools/mcp in agent.yaml).
 * Only inject tool schemas the agent has discovered via tool_search this run.
 */
export function filterExternalToolsets(
  mcpToolsets: Record<string, unknown>,
  taskToolset: Record<string, unknown>,
  discoveredIds: string[],
  declaredMcp: string[],
  declaredBuiltinTools: string[],
): Record<string, unknown> {
  const explicit = declaredMcp.length > 0 || declaredBuiltinTools.length > 0;
  if (explicit) return { ...mcpToolsets, ...taskToolset };

  const out: Record<string, unknown> = {};
  for (const [server, tools] of Object.entries(mcpToolsets)) {
    if (!tools || typeof tools !== 'object') continue;
    const kept = Object.fromEntries(
      Object.entries(tools as Record<string, unknown>).filter(([name]) =>
        discoveredIds.includes(`mcp__${server}__${name}`),
      ),
    );
    if (Object.keys(kept).length > 0) out[server] = kept;
  }
  for (const [id, tool] of Object.entries(taskToolset)) {
    if (discoveredIds.includes(id)) out[id] = tool;
  }
  return out;
}
