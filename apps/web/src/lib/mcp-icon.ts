/** Brand colors for MCP server rows in the composer menu. */
export function mcpServerIcon(serverId: string): {
  label: string;
  bg: string;
  dot: string;
} {
  const id = serverId.toLowerCase();
  if (id.includes('context7')) {
    return { label: 'C7', bg: 'bg-emerald-600', dot: 'bg-emerald-500' };
  }
  if (id.includes('playwright')) {
    return { label: 'P', bg: 'bg-zinc-500', dot: 'bg-emerald-500' };
  }
  if (id.includes('scheduling')) {
    return { label: 'S', bg: 'bg-blue-600', dot: 'bg-emerald-500' };
  }
  return {
    label: serverId.slice(0, 2).toUpperCase(),
    bg: 'bg-violet-600',
    dot: 'bg-emerald-500',
  };
}
