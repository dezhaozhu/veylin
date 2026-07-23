/**
 * Pure per-thread project-scoping resolution for grouped MCP servers.
 *
 * SCOPE NOTE (consciously deferred — not covered by this module or its callers):
 * - `agent-run.ts` (the Automate/Workflow `run_agent` node entry) invokes the agent
 *   directly and never applies a thread pin — Automate/Workflow runs are unscoped.
 * - `schedule-edit.ts` and `table-tools.ts` now resolve their Compass toolset key
 *   through `resolveCompassServer` (below) instead of a hardcoded `toolsets['compass']`
 *   lookup. Their HTTP routes (routes/tables.ts: schedule-detail, the governed
 *   schedule-edit propose/preview/commit/discard routes, load-compass-schedule) and
 *   the agent-tool closures in table-tools.ts back the workspace AG-Grid panel, which
 *   is genuinely thread-agnostic today — no threadId flows into any of those calls
 *   (see the "Fork seam" comment in routes/tables.ts) — so they resolve with `pin:
 *   null`. `resolveCompassServer` still protects them: it refuses (returns `null`,
 *   the existing "compass MCP not connected" failure path) rather than guessing
 *   `'compass'` when more than one Compass-prefixed server is connected. The one
 *   call site that IS thread-tied — `scheduleEditGuidanceBlock` from
 *   `routes/chat.ts`'s `/api/chat` handler — passes the thread's real pin and the
 *   tenant's real server groups. Threading a real threadId into the workspace grid
 *   panel itself remains debt for the next engineer.
 */

export interface ScopedMcpResult {
  active: string[];
  autoPin: string | null;
}

export interface McpToolIndexEntry {
  id: string;
  description: string;
}

/**
 * Filter a tenant-wide MCP tool-search index (as built by `indexMcpTools`,
 * entries shaped `{ id: "mcp__<server>__<tool>", description }`) down to the
 * entries whose server is in `scopedServers` — mirrors `filterExternalToolsets`'s
 * `mcp__${server}__${name}` id convention. Used to keep tool-search from leaking
 * non-pinned/non-scoped server tool names into a request's discoverable index.
 */
export function filterMcpToolIndexToScopedServers<T extends McpToolIndexEntry>(
  index: T[],
  scopedServers: string[],
): T[] {
  if (scopedServers.length === 0) return [];
  const prefixes = scopedServers.map((server) => `mcp__${server}__`);
  return index.filter((entry) => prefixes.some((prefix) => entry.id.startsWith(prefix)));
}

/**
 * Enforce a thread's project pin across grouped MCP servers.
 *
 * - Ungrouped servers (`groups[name]` is `undefined`) always pass straight
 *   through — project scoping only constrains servers that declare a group.
 * - Grouped servers are bucketed by their `group`. For each group that has
 *   at least one member in `activeMcp`:
 *   - If `pin` names a server that is both active and a member of that
 *     group, only `pin` survives from the group — every other active
 *     member is dropped.
 *   - Otherwise the pin is stale for that group (absent, disabled/inactive,
 *     or belongs to a different group), so the group auto-pins itself: the
 *     alphabetically-first active member is kept and every other member is
 *     dropped. A group with active members is never left fully empty.
 *
 * `autoPin` reports the name of at most one auto-picked server — when more
 * than one group needs auto-pinning in the same call, only the
 * alphabetically-first *group's* pick is reported (v1 limitation: a thread
 * persists a single project pin, so only one group's choice can be durably
 * remembered per call). Every group is still filtered in `active`
 * regardless of whether its pick is the one surfaced via `autoPin`.
 */
export function resolveScopedMcp(
  activeMcp: string[],
  groups: Record<string, string | undefined>,
  pin: string | null,
): ScopedMcpResult {
  const membersByGroup = new Map<string, string[]>();
  for (const name of activeMcp) {
    const group = groups[name];
    if (!group) continue;
    const members = membersByGroup.get(group);
    if (members) members.push(name);
    else membersByGroup.set(group, [name]);
  }

  const keeperByGroup = new Map<string, string>();
  const autoPinnedByGroup: { group: string; picked: string }[] = [];
  for (const [group, members] of membersByGroup) {
    if (pin != null && members.includes(pin)) {
      keeperByGroup.set(group, pin);
      continue;
    }
    const picked = [...members].sort((a, b) => a.localeCompare(b))[0]!;
    keeperByGroup.set(group, picked);
    autoPinnedByGroup.push({ group, picked });
  }

  const active = activeMcp.filter((name) => {
    const group = groups[name];
    if (!group) return true;
    return keeperByGroup.get(group) === name;
  });

  autoPinnedByGroup.sort((a, b) => a.group.localeCompare(b.group));
  const autoPin = autoPinnedByGroup[0]?.picked ?? null;

  return { active, autoPin };
}

/**
 * Resolve which connected toolset key holds the Compass MCP tools for a single
 * call — the ONE place every Compass call site (schedule-edit.ts, table-tools.ts,
 * routes/tables.ts) goes through instead of hardcoding `toolsets['compass']`.
 *
 * Why this exists: hardcoding `'compass'` is safe only for an ungrouped,
 * single-Compass deployment. Once Compass servers are grouped for per-project
 * scoping (e.g. a `compass` group member `shangzhong` plus a `compass-guolu`
 * member), a thread pinned to `compass-guolu` must never silently fall through
 * to reading (or, for governed schedule edits, WRITING) `compass` instead — that
 * would be a cross-tenant read/write that bypasses the pin without any error.
 *
 * Resolution order:
 *  1. `pin` names a connected toolset → the pin always wins.
 *  2. `'compass'` is connected AND ungrouped (`groups['compass']` is `undefined`)
 *     → use it. This is today's exact behavior for ungrouped deployments — an
 *     ungrouped server was never in scope for pin-divergence in the first place.
 *  3. Exactly one connected toolset key starts with `'compass'` → use it. Covers
 *     single-Compass deployments where the server just isn't literally named
 *     `compass`, and callers with no thread/pin context at all (e.g. the
 *     workspace grid panel — see table-tools.ts / routes/tables.ts).
 *  4. Otherwise → `null`. Callers keep their existing "compass MCP not
 *     connected" failure path — an honest failure beats a silent guess that
 *     might cross a project/tenant boundary.
 */
export function resolveCompassServer(
  toolsets: Record<string, unknown>,
  groups: Record<string, string | undefined>,
  pin: string | null,
): string | null {
  if (pin != null && Object.prototype.hasOwnProperty.call(toolsets, pin)) {
    return pin;
  }
  if (Object.prototype.hasOwnProperty.call(toolsets, 'compass') && groups['compass'] == null) {
    return 'compass';
  }
  const compassKeys = Object.keys(toolsets).filter((key) => key.startsWith('compass'));
  if (compassKeys.length === 1) {
    return compassKeys[0]!;
  }
  return null;
}
