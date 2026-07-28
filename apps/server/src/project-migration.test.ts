/**
 * Legacy entry-name → project-id migration (Phase B Task 3): pure decision
 * matrices driven directly (compass-identity.test.ts conventions) plus the
 * orchestrator against the real embedded SurrealDB with real fixture rows.
 *
 * Integration tests use a dedicated tenant (NOT DEV_TENANT_ID) so managed
 * default projects created by other suites (compass-identity integration
 * tests) can't make the source → default-project mapping ambiguous. Table
 * sheets are workspace-global, but this process never hydrates the persisted
 * store (no initTableStore), so listTableSheets() sees exactly the builtin
 * 'main' plus what this file creates — deterministic counts.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  closeDb,
  connectDb,
  getThreadStateRow,
  insertThreadState,
  listTableSheets as listTableSheetsDb,
  listThreadStatesWithProject,
  updateThreadStateProjectBulk,
} from '@veylin/db';
import type { Project } from '@veylin/shared';
import {
  COMPARE_PROJECT_NAME,
  LEGACY_COMPARE_ENTRY_NAME,
  legacyServerToProjectId,
  planPinMigration,
  planSheetSourceStamps,
  runProjectMigration,
} from './project-migration.js';
import { createProject, listProjects } from './project-store.js';
import { createTableSheet, listTableSheets, stampTableSheetSource } from './table-store.js';

/** Dedicated tenant — see module docstring. */
const TENANT = '33333333-3333-4333-8333-333333333333';

function project(overrides: Partial<Project> & Pick<Project, 'id' | 'sources'>): Project {
  return {
    tenantId: TENANT,
    name: overrides.id,
    managed: true,
    enabled: true,
    ...overrides,
  };
}

const GUOLU_DEFAULT = project({ id: 'proj-guolu', name: '锅炉厂', sources: ['guolu'] });
const SHANGZHONG_DEFAULT = project({ id: 'proj-sz', name: '上重', sources: ['shangzhong'] });
const COMPOSED_COMPARE = project({
  id: 'proj-compare',
  name: COMPARE_PROJECT_NAME,
  sources: ['guolu', 'shangzhong'],
  managed: false,
});

describe('legacyServerToProjectId (comparison-time shim)', () => {
  const projects = [GUOLU_DEFAULT, SHANGZHONG_DEFAULT, COMPOSED_COMPARE];

  it('maps compass-<src> to that source default project id', () => {
    assert.equal(legacyServerToProjectId('compass-guolu', projects), 'proj-guolu');
    assert.equal(legacyServerToProjectId('compass-shangzhong', projects), 'proj-sz');
  });

  it('maps compass-对比 to the composed 对比分析 project id (managed:false + name match)', () => {
    assert.equal(legacyServerToProjectId(LEGACY_COMPARE_ENTRY_NAME, projects), 'proj-compare');
  });

  it('a MANAGED row named 对比分析 does not satisfy the composed-project match', () => {
    const managedLookalike = project({
      id: 'proj-managed-compare',
      name: COMPARE_PROJECT_NAME,
      sources: ['guolu', 'shangzhong'],
      managed: true,
    });
    assert.equal(
      legacyServerToProjectId(LEGACY_COMPARE_ENTRY_NAME, [GUOLU_DEFAULT, managedLookalike]),
      null,
    );
  });

  it('is null for foreign servers, unknown sources, the bare prefix, and blanks', () => {
    assert.equal(legacyServerToProjectId('some-other-mcp', projects), null);
    assert.equal(legacyServerToProjectId('compass-unknown', projects), null);
    assert.equal(legacyServerToProjectId('compass-', projects), null);
    assert.equal(legacyServerToProjectId('compass', projects), null);
    assert.equal(legacyServerToProjectId('', projects), null);
    assert.equal(legacyServerToProjectId(null, projects), null);
    assert.equal(legacyServerToProjectId(undefined, projects), null);
  });

  it('still maps a DISABLED default (stamp identity survives a revoke — refusal stays hard)', () => {
    const revoked = project({ id: 'proj-guolu-off', sources: ['guolu'], enabled: false });
    assert.equal(legacyServerToProjectId('compass-guolu', [revoked]), 'proj-guolu-off');
  });

  it('a user-composed single-source project is NOT a default target', () => {
    const composedSingle = project({ id: 'proj-mine', sources: ['guolu'], managed: false });
    assert.equal(legacyServerToProjectId('compass-guolu', [composedSingle]), null);
    // …and a real default alongside it wins.
    assert.equal(
      legacyServerToProjectId('compass-guolu', [composedSingle, GUOLU_DEFAULT]),
      'proj-guolu',
    );
  });
});

describe('planPinMigration (pure)', () => {
  const defaults = [GUOLU_DEFAULT, SHANGZHONG_DEFAULT];

  it('repoints granted legacy pins; leaves foreign garbage and project-id pins untouched', () => {
    const plan = planPinMigration(
      ['compass-guolu', 'compass-shangzhong', 'some-other-mcp', 'proj-guolu'],
      defaults,
    );
    assert.deepEqual(plan.repoints, [
      { fromPin: 'compass-guolu', toProjectId: 'proj-guolu' },
      { fromPin: 'compass-shangzhong', toProjectId: 'proj-sz' },
    ]);
    assert.equal(plan.compare, null);
  });

  it('does not repoint a pin whose source default is disabled (revoked = not granted)', () => {
    const revoked = project({ id: 'proj-guolu-off', sources: ['guolu'], enabled: false });
    const plan = planPinMigration(['compass-guolu'], [revoked, SHANGZHONG_DEFAULT]);
    assert.deepEqual(plan.repoints, []);
  });

  it('dedupes repeated pin values into a single repoint (bulk update handles the rows)', () => {
    const plan = planPinMigration(['compass-guolu', 'compass-guolu', null], defaults);
    assert.deepEqual(plan.repoints, [{ fromPin: 'compass-guolu', toProjectId: 'proj-guolu' }]);
  });

  it('compare pin with an existing composed project → repoint target, no create', () => {
    const plan = planPinMigration([LEGACY_COMPARE_ENTRY_NAME], [...defaults, COMPOSED_COMPARE]);
    assert.deepEqual(plan.compare, {
      fromPin: LEGACY_COMPARE_ENTRY_NAME,
      existingProjectId: 'proj-compare',
      create: null,
    });
  });

  it('compare pin without a composed project → create {对比分析, all granted SORTED, managed:false}', () => {
    // shangzhong listed before guolu to prove sorting, plus a disabled default
    // (revoked source) that must NOT join the composed set.
    const revoked = project({ id: 'proj-x-off', sources: ['xfactory'], enabled: false });
    const plan = planPinMigration(
      [LEGACY_COMPARE_ENTRY_NAME],
      [SHANGZHONG_DEFAULT, GUOLU_DEFAULT, revoked],
    );
    assert.deepEqual(plan.compare, {
      fromPin: LEGACY_COMPARE_ENTRY_NAME,
      existingProjectId: null,
      create: { name: COMPARE_PROJECT_NAME, sources: ['guolu', 'shangzhong'], managed: false },
    });
  });

  it('compare pin with zero granted sources → no compare action (pin stays, keeps denying)', () => {
    const plan = planPinMigration([LEGACY_COMPARE_ENTRY_NAME], []);
    assert.equal(plan.compare, null);
  });

  it('never plans the composed project speculatively (no compare pin → compare null)', () => {
    const plan = planPinMigration(['compass-guolu'], defaults);
    assert.equal(plan.compare, null);
  });
});

describe('planSheetSourceStamps (pure)', () => {
  it('stamps only mappable legacy sources that lack a project — full matrix', () => {
    const projects = [GUOLU_DEFAULT, SHANGZHONG_DEFAULT, COMPOSED_COMPARE];
    const guoluSource = { server: 'compass-guolu', tenant: 'guolu', loadedAt: '2026-07-20T00:00:00.000Z' };
    const compareSource = { server: LEGACY_COMPARE_ENTRY_NAME, loadedAt: '2026-07-21T00:00:00.000Z' };
    const stamps = planSheetSourceStamps(
      [
        { id: 's-guolu', source: guoluSource },
        { id: 's-compare', source: compareSource },
        { id: 's-foreign', source: { server: 'some-other-mcp', loadedAt: '2026-07-20T00:00:00.000Z' } },
        { id: 's-unknown', source: { server: 'compass-unknown', loadedAt: '2026-07-20T00:00:00.000Z' } },
        {
          id: 's-already',
          source: { server: 'compass-guolu', loadedAt: '2026-07-20T00:00:00.000Z', project: 'proj-other' },
        },
        { id: 's-unstamped', source: null },
        { id: 's-no-source' },
      ],
      projects,
    );
    assert.deepEqual(stamps, [
      // legacy fields kept verbatim (server stays for display), project added
      { sheetId: 's-guolu', source: { ...guoluSource, project: 'proj-guolu' } },
      { sheetId: 's-compare', source: { ...compareSource, project: 'proj-compare' } },
    ]);
  });
});

describe('runProjectMigration — real store, real fixture rows', () => {
  const ts = Date.now();
  const threads = {
    guolu: `mig-guolu-${ts}`,
    shangzhong: `mig-sz-${ts}`,
    compare1: `mig-cmp1-${ts}`,
    compare2: `mig-cmp2-${ts}`,
    garbage: `mig-garbage-${ts}`,
    migrated: `mig-done-${ts}`,
  };
  let guoluId = '';
  let shangzhongId = '';
  let sheetGuoluId = '';
  let sheetCompareId = '';
  let sheetForeignId = '';
  let sheetAlreadyId = '';
  let sheetUnstampedId = '';

  function realDeps() {
    return {
      tenantId: TENANT,
      listProjects,
      createProject,
      listPinnedThreadStates: listThreadStatesWithProject,
      updateThreadStateProjectBulk,
      listSheets: () => listTableSheets(),
      stampSheetSource: stampTableSheetSource,
      log: () => {},
    };
  }

  before(async () => {
    await connectDb();

    // Default projects as the Task 2 reconcile pass leaves them (shangzhong
    // created first to prove the composed set is sorted, not insertion-order).
    shangzhongId = (
      await createProject(TENANT, { name: '上重', sources: ['shangzhong'], managed: true })
    ).id;
    guoluId = (await createProject(TENANT, { name: '锅炉厂', sources: ['guolu'], managed: true })).id;

    const state = (threadId: string, pin: string) => ({
      threadId,
      tenantId: TENANT,
      resourceId: 'user-1',
      planMode: false,
      todos: [],
      activatedSkills: {},
      pinnedSkills: [],
      project: pin,
    });
    await insertThreadState(state(threads.guolu, 'compass-guolu'));
    await insertThreadState(state(threads.shangzhong, 'compass-shangzhong'));
    await insertThreadState(state(threads.compare1, LEGACY_COMPARE_ENTRY_NAME));
    await insertThreadState(state(threads.compare2, LEGACY_COMPARE_ENTRY_NAME));
    await insertThreadState(state(threads.garbage, 'some-other-mcp'));
    await insertThreadState(state(threads.migrated, guoluId));

    const loadedAt = '2026-07-20T03:04:05.000Z';
    sheetGuoluId = createTableSheet(`mig-sheet-guolu-${ts}`)!.id;
    await stampTableSheetSource(sheetGuoluId, { server: 'compass-guolu', tenant: 'guolu', loadedAt });
    sheetCompareId = createTableSheet(`mig-sheet-compare-${ts}`)!.id;
    await stampTableSheetSource(sheetCompareId, { server: LEGACY_COMPARE_ENTRY_NAME, loadedAt });
    sheetForeignId = createTableSheet(`mig-sheet-foreign-${ts}`)!.id;
    await stampTableSheetSource(sheetForeignId, { server: 'some-other-mcp', loadedAt });
    sheetAlreadyId = createTableSheet(`mig-sheet-already-${ts}`)!.id;
    await stampTableSheetSource(sheetAlreadyId, {
      server: 'compass-guolu',
      loadedAt,
      project: 'pre-stamped-project-id',
    });
    sheetUnstampedId = createTableSheet(`mig-sheet-unstamped-${ts}`)!.id;
  });

  after(async () => {
    await closeDb();
  });

  it('first run: exact re-pointing, composed project created once, sheets stamped, garbage untouched', async () => {
    const summary = await runProjectMigration(realDeps());
    assert.deepEqual(summary, {
      pinsMigrated: 2,
      comparePinsMigrated: 2,
      sheetsStamped: 2,
      compareProjectCreated: 1,
    });

    // Legacy source pins → the exact default project ids.
    assert.equal((await getThreadStateRow(threads.guolu))?.project, guoluId);
    assert.equal((await getThreadStateRow(threads.shangzhong))?.project, shangzhongId);

    // ONE composed project, sorted sources, user-composed semantics.
    const composed = (await listProjects(TENANT)).filter(
      (p) => !p.managed && p.name === COMPARE_PROJECT_NAME,
    );
    assert.equal(composed.length, 1);
    assert.deepEqual(composed[0]!.sources, ['guolu', 'shangzhong']);
    assert.equal(composed[0]!.enabled, true);

    // Both 对比 pins re-point to that single composed project.
    assert.equal((await getThreadStateRow(threads.compare1))?.project, composed[0]!.id);
    assert.equal((await getThreadStateRow(threads.compare2))?.project, composed[0]!.id);

    // Foreign garbage pin and already-migrated project-id pin: untouched.
    assert.equal((await getThreadStateRow(threads.garbage))?.project, 'some-other-mcp');
    assert.equal((await getThreadStateRow(threads.migrated))?.project, guoluId);

    // Sheet stamps: legacy fields kept (server stays for display), project added.
    const metaById = new Map(listTableSheets().map((m) => [m.id, m]));
    assert.deepEqual(metaById.get(sheetGuoluId)?.source, {
      server: 'compass-guolu',
      tenant: 'guolu',
      loadedAt: '2026-07-20T03:04:05.000Z',
      project: guoluId,
    });
    assert.equal(metaById.get(sheetCompareId)?.source?.project, composed[0]!.id);
    assert.equal(metaById.get(sheetCompareId)?.source?.server, LEGACY_COMPARE_ENTRY_NAME);
    // Foreign server: no project added; pre-stamped: never clobbered; unstamped: untouched.
    assert.equal(metaById.get(sheetForeignId)?.source?.project, undefined);
    assert.equal(metaById.get(sheetAlreadyId)?.source?.project, 'pre-stamped-project-id');
    assert.ok(!metaById.get(sheetUnstampedId)?.source);

    // Stamps also persisted through to the real DB rows.
    const dbRows = await listTableSheetsDb();
    assert.equal(dbRows.find((r) => r.id === sheetGuoluId)?.source?.project, guoluId);
    assert.equal(dbRows.find((r) => r.id === sheetCompareId)?.source?.project, composed[0]!.id);
  });

  it('second run: all zeros and still exactly one composed project (idempotent)', async () => {
    const summary = await runProjectMigration(realDeps());
    assert.deepEqual(summary, {
      pinsMigrated: 0,
      comparePinsMigrated: 0,
      sheetsStamped: 0,
      compareProjectCreated: 0,
    });
    const composed = (await listProjects(TENANT)).filter(
      (p) => !p.managed && p.name === COMPARE_PROJECT_NAME,
    );
    assert.equal(composed.length, 1);
    // Pins stay where the first run put them.
    assert.equal((await getThreadStateRow(threads.guolu))?.project, guoluId);
    assert.equal((await getThreadStateRow(threads.garbage))?.project, 'some-other-mcp');
  });
});
