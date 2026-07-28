/**
 * Client cache of grouped remote MCP servers, fetched from GET /api/mcp-servers.
 *
 * v3 note: projects are first-class now (`lib/projects-sync.ts` /
 * GET /api/projects) and the sidebar no longer reads this module. What remains
 * grouped-server territory is the *capability* plane: the composer MCP
 * flyout's one-row-per-group toggle and chat-settings' group-toggle healing.
 * Post-cutover a group normally has the single enabled member `compass`.
 */
import { useEffect, useState } from 'react';

export type McpGroupMember = { name: string; group: string };

let cached: McpGroupMember[] | null = null;
let inflight: Promise<McpGroupMember[]> | null = null;

export async function fetchGroupedMcpServers(force = false): Promise<McpGroupMember[]> {
  if (!force && cached) return cached;
  if (!force && inflight) return inflight;
  inflight = fetch('/api/mcp-servers')
    .then((r) => r.json())
    .then((d: { remote?: { name: string; group?: string; enabled?: boolean }[] }) => {
      const grouped = (d.remote ?? [])
        // Disabled rows are excluded: the legacy managed per-scene/对比 entries
        // (compass-guolu/-shangzhong/-对比) stay in the DB disabled after the
        // v3 cutover and must not count as group members — otherwise the
        // flyout toggle and mcpEnabled healing would operate on names the
        // server never activates.
        .filter((s): s is { name: string; group: string } => Boolean(s.group) && s.enabled !== false)
        .map((s) => ({ name: s.name, group: s.group }));
      cached = grouped;
      return grouped;
    })
    .catch(() => cached ?? [])
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function readCachedGroupedMcpServers(): McpGroupMember[] | null {
  return cached;
}

/** Reactive grouped-servers list — used by the Projects sidebar to decide
 * whether to render a Projects section at all. */
export function useGroupedMcpServers(): McpGroupMember[] {
  const [servers, setServers] = useState<McpGroupMember[]>(() => cached ?? []);
  useEffect(() => {
    void fetchGroupedMcpServers().then(setServers);
  }, []);
  return servers;
}
