/**
 * POST /api/compass-identity/refresh — registered on the same app as the rest
 * of the MCP routes (routes/mcp.ts). Route-level smoke test only: the
 * reconciler's own logic is unit/integration-tested in
 * ../compass-identity.test.ts; this just proves the route is wired and calls
 * through to `deps.syncCompassIdentity`.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Fastify from 'fastify';
import { registerMcpRoutes } from './mcp.js';
import type { ServerDeps } from './types.js';

function buildDeps(overrides: Partial<ServerDeps> = {}): ServerDeps {
  return {
    runtime: {} as ServerDeps['runtime'],
    queue: {} as ServerDeps['queue'],
    resolveContext: async () => ({ tenantId: 'dev', userId: 'dev-user' }) as never,
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
    ...overrides,
  };
}

describe('POST /api/compass-identity/refresh', () => {
  it('is a no-op (ok, enabled: false) when compass-identity is not configured', async () => {
    const app = Fastify();
    registerMcpRoutes(app, buildDeps({ syncCompassIdentity: undefined }));

    const res = await app.inject({ method: 'POST', url: '/api/compass-identity/refresh' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { ok: true, enabled: false, summary: null });

    await app.close();
  });

  it('calls through to deps.syncCompassIdentity and returns its summary when configured', async () => {
    const app = Fastify();
    let calls = 0;
    // v3 summary shape: entry counts + additive default-project sync counts.
    const summary = {
      created: 1,
      adopted: 2,
      disabled: 0,
      unchanged: 3,
      projectsCreated: 2,
      projectsEnabled: 0,
      projectsDisabled: 1,
    };
    registerMcpRoutes(
      app,
      buildDeps({
        syncCompassIdentity: async () => {
          calls += 1;
          return summary;
        },
      }),
    );

    const res = await app.inject({ method: 'POST', url: '/api/compass-identity/refresh' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { ok: true, enabled: true, summary });
    assert.equal(calls, 1);

    await app.close();
  });
});
