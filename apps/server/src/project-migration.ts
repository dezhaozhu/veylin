/**
 * Legacy entry-name → project-id migration (Phase B Task 3) — see
 * docs/superpowers/specs/2026-07-27-project-cognition-v3-design.md §B1/§Cutover.
 *
 * Before v3, a thread's project pin and a sheet's provenance stamp were MCP
 * *entry names* (`compass-guolu`, `compass-shangzhong`, `compass-对比`). v3
 * re-keys both onto first-class Project rows. This module performs the
 * one-time rewrite — run at boot, AFTER a compass-identity reconcile pass (the
 * default projects must exist first), and idempotent, so a second run finds
 * nothing to do:
 *
 * 1. **Pins** (`thread_state.project`): `compass-<src>` for a granted source →
 *    that source's managed default project id. `compass-对比` → ONE
 *    user-composed project `{name: 对比分析, sources: all granted (sorted),
 *    managed: false}`, created on first need and matched by name+managed
 *    thereafter (frozen source set — future grants don't auto-join, per
 *    user-composed semantics). Pins naming unknown entries (foreign MCP
 *    servers, revoked sources, already-migrated project ids) are left
 *    untouched — they were already deny-by-default, and a revoked source's pin
 *    gets picked up by a later boot pass if the grant returns. `moved_from`
 *    values are display-only and never rewritten.
 * 2. **Provenance stamps** (`table_sheet.source`): stamps whose `server` names
 *    a legacy compass entry gain `source.project` = the mapped project id
 *    (`server` is kept for display). Stamps that already carry a `project`
 *    are never clobbered. The mismatch-comparison logic itself is Task 5c;
 *    this module only enriches stored data, plus exports the permanent
 *    comparison-time shim `legacyServerToProjectId` for 5c to consume, so an
 *    unmigrated/unmappable stamp still hard-refuses correctly.
 *
 * Mirrors compass-identity.ts's shape: pure decision functions
 * (`planPinMigration`, `planSheetSourceStamps`, `legacyServerToProjectId`)
 * that unit tests drive directly, plus an orchestrator
 * (`runProjectMigration`) taking its collaborators as `deps`.
 */
import type { TableSheetSource } from '@veylin/db';
import type { Project } from '@veylin/shared';

/** Legacy per-scene managed entry names were `compass-<source>`. */
export const LEGACY_COMPASS_ENTRY_PREFIX = 'compass-';
/** Legacy multi-scene managed entry (2+ granted sources). */
export const LEGACY_COMPARE_ENTRY_NAME = 'compass-对比';
/** Name of the user-composed project that inherits `compass-对比` pins. */
export const COMPARE_PROJECT_NAME = '对比分析';

/** Prefer an enabled row when duplicates exist (mirrors reconcile first-match). */
function preferEnabled(candidates: Project[]): Project | null {
  return candidates.find((p) => p.enabled) ?? candidates[0] ?? null;
}

/**
 * The reconciler-managed default project for a source: `managed: true` with
 * exactly that one source (same identification rule as
 * `desiredDefaultProjectsVsCurrent`). Enabled or not — provenance identity is
 * stable across revokes; callers that need "granted" check `enabled`.
 */
export function defaultProjectForSource(source: string, projects: Project[]): Project | null {
  return preferEnabled(
    projects.filter((p) => p.managed && p.sources.length === 1 && p.sources[0] === source),
  );
}

/** The composed 对比 project: matched by name + `managed: false` (idempotency key). */
export function composedCompareProject(projects: Project[]): Project | null {
  return preferEnabled(projects.filter((p) => !p.managed && p.name === COMPARE_PROJECT_NAME));
}

/** Granted ⇔ an ENABLED managed default project exists (reconcile ran just before us). */
export function grantedSourcesSorted(projects: Project[]): string[] {
  const sources = new Set<string>();
  for (const p of projects) {
    if (p.managed && p.enabled && p.sources.length === 1) sources.add(p.sources[0]!);
  }
  return Array.from(sources).sort();
}

/**
 * Comparison-time shim (permanent, consumed by Task 5c's
 * `isProjectPinMismatch` path): maps a legacy provenance `server` name to the
 * project id it denotes today — `compass-guolu` → the guolu default project
 * id, `compass-对比` → the composed 对比分析 project id. Anything
 * else (foreign servers, unknown/never-granted sources, blank) → null, which
 * callers must treat as "not this pin's project" so a legacy stamp still
 * hard-refuses under a project-id pin. Pure: the caller supplies the tenant's
 * project rows.
 */
export function legacyServerToProjectId(
  server: string | null | undefined,
  projects: Project[],
): string | null {
  if (!server) return null;
  if (server === LEGACY_COMPARE_ENTRY_NAME) {
    return composedCompareProject(projects)?.id ?? null;
  }
  if (!server.startsWith(LEGACY_COMPASS_ENTRY_PREFIX)) return null;
  const source = server.slice(LEGACY_COMPASS_ENTRY_PREFIX.length);
  if (!source) return null;
  return defaultProjectForSource(source, projects)?.id ?? null;
}

export type PinMigrationPlan = {
  /** Legacy per-source pins → default project ids (one bulk update each). */
  repoints: { fromPin: string; toProjectId: string }[];
  /**
   * `compass-对比` pin handling: re-point to the existing composed project, or
   * create it first (only when at least one source is granted — an empty
   * composed project would be meaningless, so the pin stays put and keeps
   * denying). `null` when no compare pin exists — the composed project is
   * never created speculatively.
   */
  compare: {
    fromPin: string;
    existingProjectId: string | null;
    create: { name: string; sources: string[]; managed: false } | null;
  } | null;
};

/**
 * Pure diff: current pin values vs. the tenant's project rows.
 *
 * - `compass-<src>` with an ENABLED default project (granted) → repoint.
 * - `compass-<src>` for a revoked/unknown source → untouched (already deny;
 *   a later boot pass migrates it if the grant returns).
 * - `compass-对比` → see `PinMigrationPlan.compare`.
 * - Everything else (foreign entry names, project-id pins) → untouched.
 */
export function planPinMigration(pins: (string | null)[], projects: Project[]): PinMigrationPlan {
  const distinct = Array.from(new Set(pins));
  const repoints: PinMigrationPlan['repoints'] = [];
  let compareNeeded = false;

  for (const pin of distinct) {
    if (!pin) continue;
    if (pin === LEGACY_COMPARE_ENTRY_NAME) {
      compareNeeded = true;
      continue;
    }
    if (!pin.startsWith(LEGACY_COMPASS_ENTRY_PREFIX)) continue;
    const source = pin.slice(LEGACY_COMPASS_ENTRY_PREFIX.length);
    if (!source) continue;
    const defaultProject = defaultProjectForSource(source, projects);
    if (defaultProject?.enabled) {
      repoints.push({ fromPin: pin, toProjectId: defaultProject.id });
    }
  }

  if (!compareNeeded) return { repoints, compare: null };

  const existing = composedCompareProject(projects);
  if (existing) {
    return {
      repoints,
      compare: { fromPin: LEGACY_COMPARE_ENTRY_NAME, existingProjectId: existing.id, create: null },
    };
  }
  const granted = grantedSourcesSorted(projects);
  if (granted.length === 0) return { repoints, compare: null };
  return {
    repoints,
    compare: {
      fromPin: LEGACY_COMPARE_ENTRY_NAME,
      existingProjectId: null,
      create: { name: COMPARE_PROJECT_NAME, sources: granted, managed: false },
    },
  };
}

export type SheetSourceStamp = { sheetId: string; source: TableSheetSource };

/**
 * Pure diff: sheets whose stamped `source.server` is a mappable legacy compass
 * entry name and which do not already carry `source.project` → the enriched
 * source to stamp (legacy fields kept verbatim, `project` added). Unstamped
 * sheets, foreign servers, unmappable legacy names, and already-`project`ed
 * stamps are all skipped — which is exactly what makes a second run find zero.
 */
export function planSheetSourceStamps(
  sheets: { id: string; source?: TableSheetSource | null }[],
  projects: Project[],
): SheetSourceStamp[] {
  const stamps: SheetSourceStamp[] = [];
  for (const sheet of sheets) {
    const source = sheet.source;
    if (!source?.server) continue;
    if (source.project) continue; // already migrated (or Task 5c-stamped): never clobber
    const mapped = legacyServerToProjectId(source.server, projects);
    if (!mapped) continue;
    stamps.push({ sheetId: sheet.id, source: { ...source, project: mapped } });
  }
  return stamps;
}

export type ProjectMigrationSummary = {
  pinsMigrated: number;
  comparePinsMigrated: number;
  sheetsStamped: number;
  compareProjectCreated: number;
};

export type ProjectMigrationDeps = {
  tenantId: string;
  /** Project store — server.ts binds project-store.ts. */
  listProjects: (tenantId: string) => Promise<Project[]>;
  createProject: (
    tenantId: string,
    input: { name: string; sources: string[]; managed: boolean; enabled?: boolean },
  ) => Promise<Project>;
  /** Thread pins — server.ts binds @veylin/db's listThreadStatesWithProject. */
  listPinnedThreadStates: (tenantId: string) => Promise<{ project?: string | null }[]>;
  /** Bulk repoint — returns affected-row count; server.ts binds @veylin/db's. */
  updateThreadStateProjectBulk: (
    tenantId: string,
    oldPin: string,
    newPin: string,
  ) => Promise<number>;
  /**
   * Sheet provenance — server.ts binds table-store.ts's listTableSheets /
   * stampTableSheetSource (NOT a raw db update: going through the store keeps
   * the hydrated in-memory sheet cache and the persisted row coherent).
   */
  listSheets: () => { id: string; source?: TableSheetSource | null }[];
  stampSheetSource: (sheetId: string, source: TableSheetSource) => Promise<unknown>;
  log?: (line: string) => void;
};

/**
 * One boot-time pass: plan against current pins/projects/sheets, apply, log a
 * single summary line. Idempotent — a second run returns all zeros. Must run
 * after a compass-identity reconcile pass (default projects have to exist for
 * anything to map); if that pass was skipped or failed, this degrades to a
 * safe no-op for the unmappable parts.
 */
export async function runProjectMigration(
  deps: ProjectMigrationDeps,
): Promise<ProjectMigrationSummary> {
  const log = deps.log ?? ((line: string) => console.info(line));
  const summary: ProjectMigrationSummary = {
    pinsMigrated: 0,
    comparePinsMigrated: 0,
    sheetsStamped: 0,
    compareProjectCreated: 0,
  };

  const projects = await deps.listProjects(deps.tenantId);
  const pinnedRows = await deps.listPinnedThreadStates(deps.tenantId);
  const plan = planPinMigration(
    pinnedRows.map((row) => row.project ?? null),
    projects,
  );

  for (const repoint of plan.repoints) {
    summary.pinsMigrated += await deps.updateThreadStateProjectBulk(
      deps.tenantId,
      repoint.fromPin,
      repoint.toProjectId,
    );
  }

  // The compare project (when created here) must be visible to the sheet
  // mapping below, so 对比-stamped sheets migrate in the same pass.
  let effectiveProjects = projects;
  if (plan.compare) {
    let compareProjectId = plan.compare.existingProjectId;
    if (!compareProjectId && plan.compare.create) {
      const created = await deps.createProject(deps.tenantId, {
        ...plan.compare.create,
        enabled: true,
      });
      compareProjectId = created.id;
      summary.compareProjectCreated = 1;
      effectiveProjects = [...projects, created];
    }
    if (compareProjectId) {
      summary.comparePinsMigrated += await deps.updateThreadStateProjectBulk(
        deps.tenantId,
        plan.compare.fromPin,
        compareProjectId,
      );
    }
  }

  for (const stamp of planSheetSourceStamps(deps.listSheets(), effectiveProjects)) {
    await deps.stampSheetSource(stamp.sheetId, stamp.source);
    summary.sheetsStamped += 1;
  }

  log(
    `[project-migration] tenant=${deps.tenantId} pinsMigrated=${summary.pinsMigrated} ` +
      `comparePinsMigrated=${summary.comparePinsMigrated} sheetsStamped=${summary.sheetsStamped} ` +
      `compareProjectCreated=${summary.compareProjectCreated}`,
  );
  return summary;
}
