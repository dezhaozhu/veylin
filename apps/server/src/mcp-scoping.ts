/**
 * Pure per-thread project-scoping resolution for grouped MCP servers.
 *
 * SCOPE NOTE (consciously deferred — not covered by this module or its callers):
 * - `agent-run.ts` (the Automate/Workflow `run_agent` node entry) invokes the agent
 *   directly and never applies a thread pin — Automate/Workflow runs are unscoped.
 * - `schedule-edit.ts` and `table-tools.ts` read the tool-call toolsets via a
 *   hardcoded `toolsets['compass']` key rather than resolving the pinned/scoped
 *   server name, so a grouped deployment with a non-`compass`-named pinned member
 *   would not be found by those call sites.
 * Both are debt for the next engineer picking up project-scoping, not addressed here.
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
