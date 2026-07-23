/**
 * Client-side display labels for grouped ("project") MCP servers. v1 identity
 * is the server name; this map is a small, hand-edited overlay for the
 * sidebar's human-readable labels. Unknown/new grouped servers fall back to
 * the raw server name — extend this map to rename them.
 */
const PROJECT_LABELS: Record<string, string> = {
  'compass-guolu': '锅炉厂',
  compass: '上重',
};

export function projectLabel(serverName: string): string {
  return PROJECT_LABELS[serverName] ?? serverName;
}
