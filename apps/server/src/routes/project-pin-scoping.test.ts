/**
 * POST /api/project membership validation — composes the real embedded store
 * (same pattern as mcp-store.group.test.ts / mcp-apps-scoping.test.ts)
 * against `isValidProjectPin`, the helper the route calls before persisting
 * a thread's project pin. No HTTP harness exists in this repo, so this is
 * the highest reachable seam: the route rejects/accepts purely based on
 * this function's result.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { closeDb, connectDb } from '@veylin/db';
import { isValidProjectPin } from './threads.js';
import { createRemoteMcpServer } from '../mcp-store.js';
import { DEV_TENANT_ID, ensureDevTenant } from '../tenant.js';

describe('isValidProjectPin', () => {
  before(async () => {
    await connectDb();
    await ensureDevTenant();
  });

  after(async () => {
    await closeDb();
  });

  it('null (clearing the pin) is always valid', async () => {
    assert.equal(await isValidProjectPin(DEV_TENANT_ID, null), true);
  });

  it('a name that is not a configured server at all is rejected', async () => {
    const bogus = `not-a-server-${Date.now()}`;
    assert.equal(await isValidProjectPin(DEV_TENANT_ID, bogus), false);
  });

  it('a configured but UNGROUPED server name is rejected — pinning it would do nothing', async () => {
    const suffix = Date.now();
    const ungrouped = `project-pin-ungrouped-${suffix}`;
    await createRemoteMcpServer(DEV_TENANT_ID, {
      name: ungrouped,
      transport: 'http',
      url: 'https://example.com/mcp',
      headers: {},
      enabled: true,
    });
    assert.equal(await isValidProjectPin(DEV_TENANT_ID, ungrouped), false);
  });

  it('a GROUPED server name is accepted (member of a configured group)', async () => {
    const suffix = Date.now() + 1;
    const group = `project-pin-group-${suffix}`;
    const member = `project-pin-member-${suffix}`;
    await createRemoteMcpServer(DEV_TENANT_ID, {
      name: member,
      transport: 'http',
      url: 'https://example.com/mcp',
      headers: {},
      enabled: true,
      group,
    });
    assert.equal(await isValidProjectPin(DEV_TENANT_ID, member), true);
  });

  it('a name that is a group member for a DIFFERENT tenant is rejected', async () => {
    const suffix = Date.now() + 2;
    const group = `project-pin-cross-tenant-${suffix}`;
    const member = `project-pin-cross-member-${suffix}`;
    await createRemoteMcpServer(DEV_TENANT_ID, {
      name: member,
      transport: 'http',
      url: 'https://example.com/mcp',
      headers: {},
      enabled: true,
      group,
    });
    const otherTenant = `project-pin-other-tenant-${suffix}`;
    assert.equal(await isValidProjectPin(otherTenant, member), false);
  });
});
