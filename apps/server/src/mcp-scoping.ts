/** Pure per-thread project-scoping resolution for grouped MCP servers. */

export interface ScopedMcpResult {
  active: string[];
  autoPin: string | null;
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
