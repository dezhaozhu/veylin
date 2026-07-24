/**
 * routes/tables.ts's Compass-backed routes (schedule-detail, the governed
 * schedule-edit propose/preview/commit/discard routes, load-compass-schedule)
 * follow the CURRENTLY OPEN thread's project pin: threadId (query for the GET,
 * body-or-query for the POSTs) → resolveThreadPin → resolveCompassServer.
 *
 * Same pattern as mcp-apps-scoping.test.ts: composes the real embedded store +
 * thread-state against `resolveThreadPin` and `resolveCompassServer` — the
 * exact two functions every route in routes/tables.ts calls in sequence — no
 * HTTP harness in this repo (mirrors mcp-scoping.test.ts / thread-state-
 * skills.test.ts's "thread project pin" block).
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { closeDb, connectDb } from '@veylin/db';
import { resolveCompassServer } from '../mcp-scoping.js';
import { resolveThreadPin } from '../thread-state.js';
import { ensureThreadState, setProject } from '../thread-state.js';
import { DEV_TENANT_ID, ensureDevTenant } from '../tenant.js';

const OTHER_TENANT_ID = 'other-tenant-tables-pin';
const DEV_USER = 'dev-user';

describe('routes/tables.ts pin resolution: resolveThreadPin -> resolveCompassServer', () => {
  before(async () => {
    await connectDb();
    await ensureDevTenant();
  });

  after(async () => {
    await closeDb();
  });

  it('two grouped Compass servers + a pinned thread owned by the caller: resolves to the pinned member', async () => {
    const suffix = Date.now();
    const pinned = `compass-guolu-${suffix}`;
    const other = `compass-shangzhong-${suffix}`;
    const toolsets = { [pinned]: {}, [other]: {} };
    const groups = { [pinned]: 'compass', [other]: 'compass' };

    const threadId = `thread-tables-pin-${suffix}`;
    await ensureThreadState({ threadId, tenantId: DEV_TENANT_ID, resourceId: DEV_USER });
    await setProject(threadId, pinned);

    const pin = await resolveThreadPin(threadId, { tenantId: DEV_TENANT_ID, userId: DEV_USER });
    assert.equal(pin, pinned);

    const serverName = resolveCompassServer(toolsets, groups, pin);
    assert.equal(serverName, pinned, 'must pick the pinned member, not guess ambiguously');
  });

  it('two grouped Compass servers + no threadId at all: resolveCompassServer refuses (today\'s ambiguity refusal)', async () => {
    const suffix = Date.now() + 1;
    const a = `compass-guolu-${suffix}`;
    const b = `compass-shangzhong-${suffix}`;
    const toolsets = { [a]: {}, [b]: {} };
    const groups = { [a]: 'compass', [b]: 'compass' };

    const pin = await resolveThreadPin(undefined, { tenantId: DEV_TENANT_ID, userId: DEV_USER });
    assert.equal(pin, null);

    const serverName = resolveCompassServer(toolsets, groups, pin);
    assert.equal(serverName, null, 'ambiguous — must refuse, never guess');
  });

  it('a threadId that does not exist: pin resolves to null, same refusal as missing threadId', async () => {
    const suffix = Date.now() + 2;
    const a = `compass-guolu-${suffix}`;
    const b = `compass-shangzhong-${suffix}`;
    const toolsets = { [a]: {}, [b]: {} };
    const groups = { [a]: 'compass', [b]: 'compass' };

    const pin = await resolveThreadPin(`thread-does-not-exist-${suffix}`, {
      tenantId: DEV_TENANT_ID,
      userId: DEV_USER,
    });
    assert.equal(pin, null);
    assert.equal(resolveCompassServer(toolsets, groups, pin), null);
  });

  it('a threadId belonging to another tenant: pin resolves to null (must not borrow the foreign thread\'s pin)', async () => {
    const suffix = Date.now() + 3;
    const pinned = `compass-guolu-${suffix}`;
    const other = `compass-shangzhong-${suffix}`;
    const toolsets = { [pinned]: {}, [other]: {} };
    const groups = { [pinned]: 'compass', [other]: 'compass' };

    const threadId = `thread-tables-foreign-${suffix}`;
    await ensureThreadState({ threadId, tenantId: OTHER_TENANT_ID, resourceId: DEV_USER });
    await setProject(threadId, pinned);

    const pin = await resolveThreadPin(threadId, { tenantId: DEV_TENANT_ID, userId: DEV_USER });
    assert.equal(pin, null, 'must not borrow the foreign thread\'s pin');
    assert.equal(resolveCompassServer(toolsets, groups, pin), null);
  });

  it('a threadId owned by a different user under the same tenant: pin resolves to null', async () => {
    const suffix = Date.now() + 4;
    const pinned = `compass-guolu-${suffix}`;

    const threadId = `thread-tables-otheruser-${suffix}`;
    await ensureThreadState({ threadId, tenantId: DEV_TENANT_ID, resourceId: 'someone-else' });
    await setProject(threadId, pinned);

    const pin = await resolveThreadPin(threadId, { tenantId: DEV_TENANT_ID, userId: DEV_USER });
    assert.equal(pin, null);
  });

  it('single Compass-prefixed server connected, no thread/pin: still resolves (unambiguous — unchanged from today)', async () => {
    const suffix = Date.now() + 5;
    const only = `compass-solo-${suffix}`;
    const toolsets = { [only]: {} };
    const groups = { [only]: undefined };

    const pin = await resolveThreadPin(undefined, { tenantId: DEV_TENANT_ID, userId: DEV_USER });
    assert.equal(pin, null);
    assert.equal(resolveCompassServer(toolsets, groups, pin), only);
  });

  it('owned thread with no pin set (unpinned): resolves to null, same refusal under ambiguity', async () => {
    const suffix = Date.now() + 6;
    const a = `compass-guolu-${suffix}`;
    const b = `compass-shangzhong-${suffix}`;
    const toolsets = { [a]: {}, [b]: {} };
    const groups = { [a]: 'compass', [b]: 'compass' };

    const threadId = `thread-tables-unpinned-${suffix}`;
    await ensureThreadState({ threadId, tenantId: DEV_TENANT_ID, resourceId: DEV_USER });

    const pin = await resolveThreadPin(threadId, { tenantId: DEV_TENANT_ID, userId: DEV_USER });
    assert.equal(pin, null);
    assert.equal(resolveCompassServer(toolsets, groups, pin), null);
  });
});
