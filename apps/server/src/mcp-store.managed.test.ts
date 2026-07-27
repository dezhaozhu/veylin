/**
 * MCP server `managed` field — round-trips through create/update/list against the
 * real embedded SurrealDB (same pattern as mcp-store.group.test.ts).
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { closeDb, connectDb } from '@veylin/db';
import { createRemoteMcpServer, listRemoteMcpServers, updateRemoteMcpServer } from './mcp-store.js';
import { DEV_TENANT_ID, ensureDevTenant } from './tenant.js';

const TENANT = DEV_TENANT_ID;

describe('mcp-store managed field', () => {
  before(async () => {
    await connectDb();
    await ensureDevTenant();
  });

  after(async () => {
    await closeDb();
  });

  it('creates a server marked managed and round-trips it through list', async () => {
    const created = await createRemoteMcpServer(TENANT, {
      name: `managed-${Date.now()}`,
      transport: 'http',
      url: 'https://example.com/mcp',
      headers: {},
      enabled: true,
      managed: true,
    });
    assert.equal(created.managed, true);

    const listed = await listRemoteMcpServers(TENANT);
    const found = listed.find((s) => s.id === created.id);
    assert.equal(found?.managed, true);
  });

  it('PUT can flip managed', async () => {
    const created = await createRemoteMcpServer(TENANT, {
      name: `remanage-${Date.now()}`,
      transport: 'http',
      url: 'https://example.com/mcp',
      headers: {},
      enabled: true,
      managed: true,
    });

    const updated = await updateRemoteMcpServer(TENANT, created.id, { managed: false });
    assert.equal(updated?.managed, false);
  });

  it('PUT can clear managed back to undefined', async () => {
    const created = await createRemoteMcpServer(TENANT, {
      name: `unmanage-${Date.now()}`,
      transport: 'http',
      url: 'https://example.com/mcp',
      headers: {},
      enabled: true,
      managed: true,
    });

    const updated = await updateRemoteMcpServer(TENANT, created.id, { managed: null });
    assert.equal(updated?.managed, undefined);
  });

  it('entries without managed get undefined — no schema break for old rows', async () => {
    const created = await createRemoteMcpServer(TENANT, {
      name: `nomanaged-${Date.now()}`,
      transport: 'http',
      url: 'https://example.com/mcp',
      headers: {},
      enabled: true,
    });
    assert.equal(created.managed, undefined);

    const listed = await listRemoteMcpServers(TENANT);
    const found = listed.find((s) => s.id === created.id);
    assert.equal(found?.managed, undefined);
  });
});
