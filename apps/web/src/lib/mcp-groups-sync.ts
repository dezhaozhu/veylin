/** Client cache of grouped ("project") remote MCP servers, fetched from GET /api/mcp-servers. */
import { useEffect, useState } from 'react';

export type McpGroupMember = { name: string; group: string };

let cached: McpGroupMember[] | null = null;
let inflight: Promise<McpGroupMember[]> | null = null;

export async function fetchGroupedMcpServers(force = false): Promise<McpGroupMember[]> {
  if (!force && cached) return cached;
  if (!force && inflight) return inflight;
  inflight = fetch('/api/mcp-servers')
    .then((r) => r.json())
    .then((d: { remote?: { name: string; group?: string }[] }) => {
      const grouped = (d.remote ?? [])
        .filter((s): s is { name: string; group: string } => Boolean(s.group))
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
