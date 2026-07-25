/** Client cache of grouped ("project") remote MCP servers, fetched from GET /api/mcp-servers. */
import { useEffect, useState } from 'react';

export type McpGroupMember = { name: string; group: string };
export type McpServerHealthInfo = { connected: boolean; toolCount: number };

let cached: McpGroupMember[] | null = null;
let healthCached: Map<string, McpServerHealthInfo> | null = null;
let inflight: Promise<McpGroupMember[]> | null = null;

export async function fetchGroupedMcpServers(force = false): Promise<McpGroupMember[]> {
  if (!force && cached) return cached;
  if (!force && inflight) return inflight;
  inflight = fetch('/api/mcp-servers')
    .then((r) => r.json())
    .then(
      (d: {
        remote?: { name: string; group?: string }[];
        health?: { servers?: { name: string; connected: boolean; toolCount: number }[] } | null;
      }) => {
        const grouped = (d.remote ?? [])
          .filter((s): s is { name: string; group: string } => Boolean(s.group))
          .map((s) => ({ name: s.name, group: s.group }));
        cached = grouped;
        healthCached = new Map(
          (d.health?.servers ?? []).map((h) => [
            h.name,
            { connected: h.connected, toolCount: h.toolCount },
          ]),
        );
        return grouped;
      },
    )
    .catch(() => cached ?? [])
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function readCachedGroupedMcpServers(): McpGroupMember[] | null {
  return cached;
}

export function readCachedMcpServerHealth(): Map<string, McpServerHealthInfo> | null {
  return healthCached;
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

/** Reactive per-server connection health (name -> connected/toolCount), same
 * /api/mcp-servers payload as useGroupedMcpServers — just surfacing the
 * `health.servers[]` half instead of the grouping half. Used by the composer
 * MCP flyout's capability-status row to show whether the current thread's
 * pinned group member is actually connected. */
export function useMcpServerHealth(): Map<string, McpServerHealthInfo> {
  const [health, setHealth] = useState<Map<string, McpServerHealthInfo>>(
    () => healthCached ?? new Map(),
  );
  useEffect(() => {
    void fetchGroupedMcpServers().then(() => {
      setHealth(healthCached ?? new Map());
    });
  }, []);
  return health;
}
