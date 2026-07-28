/**
 * Security review F1 — managed (reconciler-owned) MCP rows are structurally
 * immutable via the /api/mcp-servers CRUD: a user PUT changing a managed
 * compass row's `group` would move it out of COMPASS_IDENTITY_GROUP, letting
 * the next rebuild open a HEADERLESS compass connection on the generic
 * clients. PUT/DELETE on managed rows must 403; manual rows stay editable.
 *
 * Harness style of projects.test.ts (Fastify inject + real embedded store,
 * dedicated tenant so other suites can't blur the row set).
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { closeDb, connectDb } from '@veylin/db';
import { COMPASS_IDENTITY_GROUP } from '../compass-identity.js';
import { createRemoteMcpServer, listRemoteMcpServers, updateRemoteMcpServer } from '../mcp-store.js';
import { registerMcpRoutes } from './mcp.js';
import type { ServerDeps } from './types.js';

const TENANT = '77777777-7777-4777-8777-777777777777';

function buildDeps(): ServerDeps {
  return {
    runtime: {} as ServerDeps['runtime'],
    queue: {} as ServerDeps['queue'],
    resolveContext: async () => ({ tenantId: TENANT, userId: 'user-1' }) as never,
    isForbiddenError: () => false,
    rebuildMcp: async () => undefined,
    ensureMcpForTenant: async () => undefined,
    getMcpToolsets: () => ({}),
    getMcpGroups: () => ({}),
    getMcpToolIndex: () => [],
    getTaskToolset: () => ({}),
    readTaskSnapshot: async () => ({ tasks: [] }),
    subscribeTaskEvents: () => () => undefined,
    mcpHealthByTenant: new Map(),
    RAG_UPLOAD_MAX_BYTES: 1024,
  };
}

describe('managed MCP row immutability (F1)', () => {
  let app: FastifyInstance;
  let managedId: string;
  let manualId: string;

  before(async () => {
    await connectDb();
    app = Fastify();
    registerMcpRoutes(app, buildDeps());

    const managed = await createRemoteMcpServer(TENANT, {
      name: 'compass',
      transport: 'http',
      url: 'http://example.invalid/mcp/',
      headers: { Authorization: 'Bearer x' },
      enabled: true,
      group: COMPASS_IDENTITY_GROUP,
    });
    managedId = managed.id;
    // The reconciler marks its rows managed via the store update path.
    await updateRemoteMcpServer(TENANT, managedId, { managed: true });

    const manual = await createRemoteMcpServer(TENANT, {
      name: 'caliper',
      transport: 'http',
      url: 'http://example.invalid/other/',
      enabled: true,
    });
    manualId = manual.id;
  });

  after(async () => {
    await app.close();
    await closeDb();
  });

  it('PUT on a managed row → 403, row byte-unchanged (group cannot leave the protection group)', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/mcp-servers/${managedId}`,
      payload: { group: 'foo' },
    });
    assert.equal(res.statusCode, 403);
    const row = (await listRemoteMcpServers(TENANT)).find((r) => r.id === managedId);
    assert.equal(row?.group, COMPASS_IDENTITY_GROUP);
    assert.equal(row?.managed, true);
  });

  it('PUT stripping managed/headers on a managed row → refused (400: body-level system-field rejection fires before the 403 target check), row byte-unchanged', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/mcp-servers/${managedId}`,
      payload: { managed: false, headers: {} },
    });
    assert.equal(res.statusCode, 400);
    const row = (await listRemoteMcpServers(TENANT)).find((r) => r.id === managedId);
    assert.equal(row?.managed, true);
    assert.deepEqual(row?.headers, { Authorization: 'Bearer x' });
  });

  it('DELETE on a managed row → 403, row survives', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/api/mcp-servers/${managedId}` });
    assert.equal(res.statusCode, 403);
    assert.ok((await listRemoteMcpServers(TENANT)).some((r) => r.id === managedId));
  });

  it('POST minting managed:true → 400 (no self-locked zombie rows)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/mcp-servers',
      payload: { name: 'zombie', transport: 'http', url: 'http://x.invalid/', managed: true },
    });
    assert.equal(res.statusCode, 400);
    assert.ok(!(await listRemoteMcpServers(TENANT)).some((r) => r.name === 'zombie'));
  });

  it('POST into the compass protection group → 400 (no second enabled group member)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/mcp-servers',
      payload: {
        name: 'impostor',
        transport: 'http',
        url: 'http://x.invalid/',
        group: COMPASS_IDENTITY_GROUP,
      },
    });
    assert.equal(res.statusCode, 400);
    assert.ok(!(await listRemoteMcpServers(TENANT)).some((r) => r.name === 'impostor'));
  });

  it('PUT converting a manual row to managed or into the group → 400, row untouched', async () => {
    for (const payload of [{ managed: true }, { group: COMPASS_IDENTITY_GROUP }]) {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/mcp-servers/${manualId}`,
        payload,
      });
      assert.equal(res.statusCode, 400);
    }
    const row = (await listRemoteMcpServers(TENANT)).find((r) => r.id === manualId);
    assert.ok(!row?.managed);
    assert.ok(row?.group !== COMPASS_IDENTITY_GROUP);
  });

  it('POST with an unrelated group stays allowed (generic grouping intact)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/mcp-servers',
      payload: { name: 'grouped-ok', transport: 'http', url: 'http://x.invalid/', group: 'misc' },
    });
    assert.equal(res.statusCode, 200);
    const row = (await listRemoteMcpServers(TENANT)).find((r) => r.name === 'grouped-ok');
    assert.equal(row?.group, 'misc');
  });

  it('manual rows stay editable and deletable', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: `/api/mcp-servers/${manualId}`,
      payload: { url: 'http://example.invalid/updated/' },
    });
    assert.equal(put.statusCode, 200);
    const del = await app.inject({ method: 'DELETE', url: `/api/mcp-servers/${manualId}` });
    assert.equal(del.statusCode, 200);
    assert.ok(!(await listRemoteMcpServers(TENANT)).some((r) => r.id === manualId));
  });
});
