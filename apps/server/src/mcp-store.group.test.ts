/**
 * MCP server `group` field — round-trips through create/update/list against the
 * real embedded SurrealDB (same pattern as persist-audit.test.ts).
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { closeDb, connectDb } from '@veylin/db';
import {
  createRemoteMcpServer,
  listRemoteMcpServers,
  updateRemoteMcpServer,
} from './mcp-store.js';
import { DEV_TENANT_ID, ensureDevTenant } from './tenant.js';

const TENANT = DEV_TENANT_ID;

describe('mcp-store group field', () => {
  before(async () => {
    await connectDb();
    await ensureDevTenant();
  });

  after(async () => {
    await closeDb();
  });

  it('creates a server with a group and round-trips it through list', async () => {
    const created = await createRemoteMcpServer(TENANT, {
      name: `grouped-${Date.now()}`,
      transport: 'http',
      url: 'https://example.com/mcp',
      headers: {},
      enabled: true,
      group: 'compass',
    });
    assert.equal(created.group, 'compass');

    const listed = await listRemoteMcpServers(TENANT);
    const found = listed.find((s) => s.id === created.id);
    assert.equal(found?.group, 'compass');
  });

  it('PUT can change the group', async () => {
    const created = await createRemoteMcpServer(TENANT, {
      name: `regroup-${Date.now()}`,
      transport: 'http',
      url: 'https://example.com/mcp',
      headers: {},
      enabled: true,
      group: 'compass',
    });

    const updated = await updateRemoteMcpServer(TENANT, created.id, { group: 'other-project' });
    assert.equal(updated?.group, 'other-project');
  });

  it('PUT can clear the group', async () => {
    const created = await createRemoteMcpServer(TENANT, {
      name: `ungroup-${Date.now()}`,
      transport: 'http',
      url: 'https://example.com/mcp',
      headers: {},
      enabled: true,
      group: 'compass',
    });

    const updated = await updateRemoteMcpServer(TENANT, created.id, { group: null });
    assert.equal(updated?.group, undefined);
  });

  it('entries without a group get undefined — no schema break for old rows', async () => {
    const created = await createRemoteMcpServer(TENANT, {
      name: `nogroup-${Date.now()}`,
      transport: 'http',
      url: 'https://example.com/mcp',
      headers: {},
      enabled: true,
    });
    assert.equal(created.group, undefined);

    const listed = await listRemoteMcpServers(TENANT);
    const found = listed.find((s) => s.id === created.id);
    assert.equal(found?.group, undefined);
  });
});
