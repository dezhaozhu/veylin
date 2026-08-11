import type { ToolsetsGetter } from './table-tools.js';

/**
 * Pure per-thread project-scoping resolution for grouped MCP servers.
 *
 * PROJECT-PIN RE-KEY (project-cognition v3, Phase B): a thread's pin is now a
 * PROJECT id (`thread_state.project` → `project` table row), not an MCP entry
 * name. The pure functions below still operate on entry-level names — callers
 * translate the pin EXACTLY ONCE per request through the shared prelude
 * `resolvePinnedProjectScope` (project-store.ts), which resolves an enabled
 * tenant-owned project to `entryPin` = the enabled `COMPASS_IDENTITY_GROUP`
 * member's name ('compass') and denies everything else (missing / foreign /
 * disabled ⇒ `entryPin: null`, same posture as the old stale-pin path). The
 * functions and their tests are unchanged by design: the three
 * review-hardened isolation guarantees (mcpEnabled attack, unpinned deny,
 * explicit-off subagent suppression) hold byte-equivalently at this level,
 * while WHICH DATA backs the surviving `compass` key is decided by the
 * compass client pool (compass-pool.ts) — one connection per (tenant, entry,
 * scene-set), bound via the `x-compass-source` header composed from the
 * pinned project's sources. See routes/chat.ts's `resolveChatMcpScope` for
 * the chat-path composition and its guarantee-preservation notes.
 *
 * SCOPE NOTE (consciously deferred — not covered by this module or its callers):
 * - `agent-run.ts` (the Automate/Workflow `run_agent` node entry) invokes the agent
 *   directly and never applies a thread pin — Automate/Workflow runs are unscoped.
 * - `schedule-edit.ts` and `table-tools.ts` resolve their Compass toolset key
 *   through `resolveCompassServer` (below) instead of a hardcoded `toolsets['compass']`
 *   lookup — re-keyed onto project scoping by Phase B 5c. Their HTTP routes
 *   (routes/tables.ts: schedule-detail, the governed schedule-edit
 *   propose/preview/commit/discard routes, load-compass-schedule) resolve the
 *   request's `threadId` (query for the GET, body-or-query for the POSTs — see
 *   `threadIdFromRequest` in routes/tables.ts) via `resolveThreadPin`
 *   (thread-state.ts, the same `resolveThreadForRead` ownership check
 *   routes/mcp-apps.ts's `resolveScopedServerNames` applies) into a PROJECT-id
 *   pin, then through the shared prelude + pool
 *   (`resolveCompassRequestScope`): a granted pin yields the POOLED scene-set
 *   toolsets + `entryPin`; a missing/foreign threadId or denied pin falls back
 *   to the tenant toolsets with `pin: null` (pre-threading refusal behavior,
 *   unchanged — and post-cutover the tenant cache holds no compass at all).
 *   The `load_compass_*` agent-tool closures in table-tools.ts resolve their
 *   scope from the chat request's `requestContext` (`scopedMcpToolsets` +
 *   `pinnedProjectScope`, set by routes/chat.ts — see `compassScopeFromCtx`),
 *   since they run inside an already-scoped chat turn. `resolveCompassServer`
 *   still protects every caller: it refuses (returns `null`, the existing
 *   "compass MCP not connected" failure path) rather than guessing under any
 *   ambiguity. The other call site that is thread-tied —
 *   `scheduleEditGuidanceBlock` from `routes/chat.ts`'s `/api/chat` handler — is
 *   passed the per-request pooled toolsets (`agentMcp`) and the entry-level pin.
 *   Provenance is re-keyed with it: sheets stamp `source.project` = the pinned
 *   PROJECT id (never the resolved toolset key — plan risk #1) and
 *   `isProjectPinMismatch` (table-store.ts) compares project ids, with the
 *   permanent `legacyServerToProjectId` shim for pre-migration stamps.
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

/** Server-name → project-group map, e.g. `{ compass: undefined, 'compass-guolu': 'compass' }`. */
export type McpServerGroups = Record<string, string | undefined>;

export type CompassTool = { execute: (args: unknown) => Promise<unknown> };

/**
 * Look up a Compass MCP tool by name, resolved through `resolveCompassServer`
 * (never a hardcoded `toolsets['compass']`) so a grouped deployment can't leak
 * a call across the thread's project pin. `groups`/`pin` default to `{}`/`null`
 * for callers with no thread context.
 *
 * Shared by schedule-edit.ts (governed writes) and compass-grounding.ts (the
 * read-only grounding block's "is compass connected" probe) — ONE copy on
 * purpose: a second copy would drift from the pin-resolution rules above.
 */
export function compassTool(
  getToolsets: ToolsetsGetter | undefined,
  name: string,
  groups: McpServerGroups = {},
  pin: string | null = null,
): CompassTool | null {
  const toolsets = getToolsets?.() ?? {};
  const serverName = resolveCompassServer(toolsets, groups, pin);
  if (!serverName) return null;
  const server = toolsets[serverName] as Record<string, CompassTool> | undefined;
  return server?.[name] ?? null;
}
