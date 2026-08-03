/**
 * Project store — CRUD round-trips against the real embedded SurrealDB (same
 * pattern as mcp-store.group.test.ts / mcp-store.managed.test.ts), plus the
 * tenant-isolation and sources guarantees the Phase B scoping work builds on.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  closeDb,
  connectDb,
  getThreadStateRow,
  insertThreadState,
  updateThreadStateProjectBulk,
} from '@veylin/db';
import {
  assertSourcesGranted,
  createProject,
  disableProject,
  getProject,
  listProjects,
  updateProject,
} from './project-store.js';
import { DEV_TENANT_ID, ensureDevTenant } from './tenant.js';

const TENANT = DEV_TENANT_ID;
const OTHER_TENANT = '11111111-1111-1111-1111-111111111111';

function baseThreadState(threadId: string, tenantId: string, project: string | null) {
  return {
    threadId,
    tenantId,
    resourceId: 'user-1',
    planMode: false,
    todos: [],
    activatedSkills: {},
    pinnedSkills: [],
    project,
  };
}

describe('project store', () => {
  before(async () => {
    await connectDb();
    await ensureDevTenant();
  });

  after(async () => {
    await closeDb();
  });

  it('creates a project and round-trips it through list and get', async () => {
    const created = await createProject(TENANT, {
      name: `锅炉厂-${Date.now()}`,
      sources: ['guolu'],
      managed: true,
    });
    assert.ok(created.id);
    assert.equal(created.tenantId, TENANT);
    assert.deepEqual(created.sources, ['guolu']);
    assert.equal(created.managed, true);
    assert.equal(created.enabled, true);

    const listed = await listProjects(TENANT);
    const found = listed.find((p) => p.id === created.id);
    assert.ok(found, 'created project appears in listProjects');
    assert.equal(found.name, created.name);
    assert.deepEqual(found.sources, ['guolu']);

    const got = await getProject(TENANT, created.id);
    assert.equal(got?.id, created.id);
    assert.equal(got?.managed, true);
  });

  it('defaults: managed false, enabled true when omitted', async () => {
    const created = await createProject(TENANT, {
      name: `composed-${Date.now()}`,
      sources: ['guolu', 'shangzhong'],
    });
    assert.equal(created.managed, false);
    assert.equal(created.enabled, true);
  });

  it('multi-source sources array round-trips with order preserved', async () => {
    const created = await createProject(TENANT, {
      name: `对比-${Date.now()}`,
      sources: ['guolu', 'shangzhong'],
    });
    const got = await getProject(TENANT, created.id);
    assert.deepEqual(got?.sources, ['guolu', 'shangzhong']);
  });

  it('update can rename and re-tick sources', async () => {
    const created = await createProject(TENANT, {
      name: `rename-me-${Date.now()}`,
      sources: ['guolu'],
    });

    const updated = await updateProject(TENANT, created.id, {
      name: '新名字',
      sources: ['guolu', 'shangzhong'],
    });
    assert.equal(updated?.name, '新名字');
    assert.deepEqual(updated?.sources, ['guolu', 'shangzhong']);

    const got = await getProject(TENANT, created.id);
    assert.equal(got?.name, '新名字');
    assert.deepEqual(got?.sources, ['guolu', 'shangzhong']);
  });

  it('disable keeps the row (disabled-not-deleted) with enabled=false', async () => {
    const created = await createProject(TENANT, {
      name: `disable-me-${Date.now()}`,
      sources: ['guolu'],
    });

    const disabled = await disableProject(TENANT, created.id);
    assert.equal(disabled?.enabled, false);

    // Still present for history/reconciler re-enable — not deleted.
    const got = await getProject(TENANT, created.id);
    assert.equal(got?.enabled, false);

    const reEnabled = await updateProject(TENANT, created.id, { enabled: true });
    assert.equal(reEnabled?.enabled, true);
  });

  it('tenant isolation: tenant B cannot read, list, update, or disable tenant A projects', async () => {
    const created = await createProject(TENANT, {
      name: `isolated-${Date.now()}`,
      sources: ['guolu'],
    });

    assert.equal(await getProject(OTHER_TENANT, created.id), null);

    const otherList = await listProjects(OTHER_TENANT);
    assert.ok(!otherList.some((p) => p.id === created.id));

    assert.equal(await updateProject(OTHER_TENANT, created.id, { name: 'stolen' }), null);
    assert.equal(await disableProject(OTHER_TENANT, created.id), null);

    // Foreign-tenant attempts left the row untouched.
    const got = await getProject(TENANT, created.id);
    assert.equal(got?.name, created.name);
    assert.equal(got?.enabled, true);
  });

  it('updateThreadStateProjectBulk re-points matching pins only, scoped to the tenant', async () => {
    const stamp = Date.now();
    const oldPin = `compass-guolu-${stamp}`;
    const newPin = `project-id-${stamp}`;
    const migrated1 = `bulk-a-${stamp}`;
    const migrated2 = `bulk-b-${stamp}`;
    const otherPinned = `bulk-c-${stamp}`;
    const unpinned = `bulk-d-${stamp}`;
    const foreignTenant = `bulk-e-${stamp}`;

    await insertThreadState(baseThreadState(migrated1, TENANT, oldPin));
    await insertThreadState(baseThreadState(migrated2, TENANT, oldPin));
    await insertThreadState(baseThreadState(otherPinned, TENANT, `compass-shangzhong-${stamp}`));
    await insertThreadState(baseThreadState(unpinned, TENANT, null));
    await insertThreadState(baseThreadState(foreignTenant, OTHER_TENANT, oldPin));

    const count = await updateThreadStateProjectBulk(TENANT, oldPin, newPin);
    assert.equal(count, 2);

    assert.equal((await getThreadStateRow(migrated1))?.project, newPin);
    assert.equal((await getThreadStateRow(migrated2))?.project, newPin);
    assert.equal((await getThreadStateRow(otherPinned))?.project, `compass-shangzhong-${stamp}`);
    assert.equal((await getThreadStateRow(unpinned))?.project, null);
    // Other tenant's identical pin value is untouched.
    assert.equal((await getThreadStateRow(foreignTenant))?.project, oldPin);

    // Idempotent: a second run matches nothing.
    assert.equal(await updateThreadStateProjectBulk(TENANT, oldPin, newPin), 0);
  });

  describe('assertSourcesGranted', () => {
    const granted = ['guolu', 'shangzhong'];

    it('accepts a strict subset', () => {
      assertSourcesGranted(['guolu'], granted);
    });

    it('accepts the full granted set', () => {
      assertSourcesGranted(['guolu', 'shangzhong'], granted);
    });

    it('accepts empty sources (source-less project folders)', () => {
      assertSourcesGranted([], granted);
    });

    it('throws when any source is ungranted', () => {
      assert.throws(
        () => assertSourcesGranted(['guolu', 'duanjian'], granted),
        /not granted.*duanjian/,
      );
    });

    it('throws when nothing is granted at all', () => {
      assert.throws(() => assertSourcesGranted(['guolu'], []), /not granted/);
    });
  });
});
