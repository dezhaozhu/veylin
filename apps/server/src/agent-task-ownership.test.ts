/**
 * Security review F4 — `task_continue` ownership.
 *
 * The handler used to fetch the task row by id alone. A foreign `task_id`
 * (guessed or leaked) would then prepend THAT row's stored prompt to a run
 * holding the CALLER's scoped toolsets and write the result back into the
 * foreign row. `isTaskVisibleToTenant` is the gate; a cross-tenant id is
 * reported exactly like a missing one, so the tool is not an existence oracle.
 *
 * Pure-predicate tests (the scene-card-grid precedent): the handler's own
 * async path enqueues and then polls a worker, which cannot be driven to
 * completion with a fake queue, so the decision itself is what gets pinned.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isTaskVisibleToTenant } from './agent-task-tool';

const OWNER = '88888888-8888-4888-8888-888888888888';
const FOREIGN = '99999999-9999-4999-8999-999999999999';

describe('task_continue ownership gate (F4)', () => {
  it("accepts the owning tenant's own row", () => {
    assert.equal(isTaskVisibleToTenant({ tenantId: OWNER }, OWNER), true);
  });

  it('refuses a row belonging to another tenant', () => {
    assert.equal(isTaskVisibleToTenant({ tenantId: OWNER }, FOREIGN), false);
  });

  it('refuses a missing row identically — no existence oracle', () => {
    assert.equal(isTaskVisibleToTenant(null, FOREIGN), false);
    assert.equal(isTaskVisibleToTenant(undefined, OWNER), false);
  });

  it('refuses a row with no tenant at all (malformed / legacy)', () => {
    assert.equal(isTaskVisibleToTenant({}, OWNER), false);
  });

  it('does not fall back to a truthy-ish comparison', () => {
    assert.equal(isTaskVisibleToTenant({ tenantId: '' }, ''), false);
  });
});
