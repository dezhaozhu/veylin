/**
 * Structural identity of the migration-owned composed project (v3 review's
 * "riskiest residual assumption").
 *
 * `composedCompareProject` matches on the set-once `migrated_from` marker, and
 * the boot migration creates the row check-then-insert. With one writer that
 * is sound; with two processes reconciling one database it could mint two
 * marker rows and split pins/provenance stamps across two ids permanently.
 * A DB-level unique index on (tenant_id, migrated_from) makes the invariant
 * true by construction — the prerequisite for arch-debt #3 (双实例收敛).
 *
 * Rows without the marker must be unaffected: users compose as many projects
 * as they like, including several with the same NAME.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { closeDb, connectDb } from '@veylin/db';
import { createProject, listProjects } from './project-store';

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MARKER = 'compass-对比';

describe('composed-project identity is DB-enforced', () => {
  before(async () => {
    await connectDb();
  });
  after(async () => {
    await closeDb();
  });

  it('a second marker row for the same tenant is rejected by the DB', async () => {
    await createProject(TENANT, {
      name: '对比分析',
      sources: ['guolu', 'shangzhong'],
      migratedFrom: MARKER,
    });
    await assert.rejects(
      () =>
        createProject(TENANT, {
          name: '对比分析',
          sources: ['guolu'],
          migratedFrom: MARKER,
        }),
      'a duplicate marker row must not be creatable',
    );
    const marked = (await listProjects(TENANT)).filter((p) => p.migratedFrom === MARKER);
    assert.equal(marked.length, 1);
  });

  it('another tenant may hold its own marker row (scoped, not global)', async () => {
    const row = await createProject(OTHER, {
      name: '对比分析',
      sources: ['guolu', 'shangzhong'],
      migratedFrom: MARKER,
    });
    assert.equal(row.migratedFrom, MARKER);
  });

  it('unmarked user projects are unconstrained — same name is fine', async () => {
    await createProject(TENANT, { name: '对比分析', sources: ['guolu'] });
    await createProject(TENANT, { name: '对比分析', sources: ['shangzhong'] });
    const sameName = (await listProjects(TENANT)).filter((p) => p.name === '对比分析');
    // two user-composed + the one marker row
    assert.equal(sameName.length, 3);
    assert.equal(sameName.filter((p) => p.migratedFrom === MARKER).length, 1);
  });
});
