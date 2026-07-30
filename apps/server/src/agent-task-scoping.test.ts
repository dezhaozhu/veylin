/**
 * Subagent MCP scoping. NOTE on currency (project-cognition v3, Phase B 5c):
 * the allowlist (`scopedMcpServers`) stays ENTRY-LEVEL server names — it is
 * derived by routes/chat.ts AFTER the project pin was translated through the
 * shared prelude, so no project ids appear here by design. What v3 adds is
 * the OVERLAY: the dispatching request's per-request toolset record
 * (`scopedMcpToolsets`, pooled compass included) resolved overlay-first in
 * toolsetsForPreset — the tests in the last describe pin plan risk #2
 * (compass can only ever come from the parent request's pooled overlay,
 * never from the tenant-level cache, which cannot contain it post-Task-4).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Runtime } from '@veylin/runtime';
import { runSubagentGenerate, scopeServersToAllowlist } from './agent-task-runner.js';

/** Minimal fake runtime: only the two members runSubagentGenerate touches. */
function fakeRuntime(
  agentId: string,
  mcpServers: string[],
  capture: { toolsets?: Record<string, unknown> },
): Runtime {
  return {
    definitions: new Map([[agentId, { definition: { mcpServers } }]]),
    getAgent: () => ({
      generate: async (_prompt: string, opts: { toolsets?: Record<string, unknown> }) => {
        capture.toolsets = opts.toolsets;
        return { text: 'ok' };
      },
    }),
  } as unknown as Runtime;
}

describe('scopeServersToAllowlist', () => {
  it('passes servers through unchanged when no allowlist is given (no scoping context)', () => {
    assert.deepEqual(scopeServersToAllowlist(['guolu', 'shangzhong']), ['guolu', 'shangzhong']);
  });

  it("intersects declared servers with the dispatching request's scoped allowlist", () => {
    assert.deepEqual(scopeServersToAllowlist(['guolu', 'shangzhong'], ['guolu']), ['guolu']);
  });

  it('drops every server when the allowlist is empty (fully scoped-out request)', () => {
    assert.deepEqual(scopeServersToAllowlist(['guolu', 'shangzhong'], []), []);
  });

  it('is a no-op for servers not declared by the subagent, allowlist or not', () => {
    assert.deepEqual(scopeServersToAllowlist(['guolu'], ['guolu', 'shangzhong']), ['guolu']);
  });
});

// Integration-style: exercises runSubagentGenerate end to end (minus the real
// Mastra agent/hooks) with fakes, mirroring agent-task-await.test.ts's
// no-DB-needed style, to prove toolsetsForPreset's intersection actually
// reaches the toolsets handed to agent.generate — the seam that gates what a
// dispatched subagent can call.
describe('runSubagentGenerate MCP scoping', () => {
  it('a subagent dispatched from a pinned thread only receives the pinned server toolset', async () => {
    const capture: { toolsets?: Record<string, unknown> } = {};
    const runtime = fakeRuntime('researcher', ['guolu', 'shangzhong'], capture);
    const deps = {
      mcpToolsets: {
        guolu: { list_orders: {} },
        shangzhong: { list_orders: {} },
      },
    };

    await runSubagentGenerate({
      runtime,
      deps,
      agentId: 'researcher',
      prompt: 'do the thing',
      threadId: 'subagent-thread-pinned',
      resourceId: 'user-1',
      tenantId: 'tenant-1',
      scopedMcpServers: ['guolu'],
    });

    assert.deepEqual(Object.keys(capture.toolsets ?? {}), ['guolu']);
  });

  it('no scoping context at dispatch time (e.g. Automate/Workflow) keeps today\'s unscoped behavior', async () => {
    const capture: { toolsets?: Record<string, unknown> } = {};
    const runtime = fakeRuntime('researcher', ['guolu', 'shangzhong'], capture);
    const deps = {
      mcpToolsets: {
        guolu: { list_orders: {} },
        shangzhong: { list_orders: {} },
      },
    };

    await runSubagentGenerate({
      runtime,
      deps,
      agentId: 'researcher',
      prompt: 'do the thing',
      threadId: 'subagent-thread-unscoped',
      resourceId: 'user-1',
      tenantId: 'tenant-1',
    });

    assert.deepEqual(Object.keys(capture.toolsets ?? {}).sort(), ['guolu', 'shangzhong']);
  });
});

// Plan risk #2 (wrong-scene-set toolset substitution): a subagent's compass
// toolset can ONLY be the parent request's pooled overlay — the tenant-level
// cache (deps.mcpToolsets) never contains compass post-Task-4, and
// toolsetsForPreset resolves overlay-first, so a tenant-cache entry can never
// shadow or substitute the scene-set-bound one. The recording proxy below
// pins WHICH map was consulted per server.
describe('runSubagentGenerate overlay toolsets (pooled compass for subagents)', () => {
  /** deps.mcpToolsets stand-in that records every key consulted. */
  function recordingDeps(entries: Record<string, unknown>, consulted: string[]) {
    return {
      mcpToolsets: new Proxy(entries, {
        get(target, prop) {
          if (typeof prop === 'string') consulted.push(prop);
          return (target as Record<string, unknown>)[prop as string];
        },
      }) as Record<string, unknown>,
    };
  }

  it('subagent receives the parent request\'s POOLED compass overlay — the tenant cache is never consulted for it', async () => {
    const capture: { toolsets?: Record<string, unknown> } = {};
    const runtime = fakeRuntime('researcher', ['compass', 'github'], capture);
    const consulted: string[] = [];
    // Post-Task-4 truth: the tenant cache holds only ordinary servers, never compass.
    const tenantGithub = { search_issues: {} };
    const deps = recordingDeps({ github: tenantGithub }, consulted);
    // The parent chat turn's scopedMcpToolsets: pooled compass (scene-set-bound).
    const pooledCompass = { get_schedule_rows: {} };
    const overlay = { compass: pooledCompass };

    await runSubagentGenerate({
      runtime,
      deps,
      agentId: 'researcher',
      prompt: 'do the thing',
      threadId: 'subagent-thread-overlay',
      resourceId: 'user-1',
      tenantId: 'tenant-1',
      scopedMcpServers: ['compass', 'github'],
      overlayToolsets: overlay,
    });

    assert.deepEqual(Object.keys(capture.toolsets ?? {}).sort(), ['compass', 'github']);
    assert.equal(
      capture.toolsets?.['compass'],
      pooledCompass,
      'compass toolset must be the overlay object itself (the pooled, scene-set-bound one)',
    );
    assert.ok(
      !consulted.includes('compass'),
      'the tenant cache must never be consulted for compass (overlay-first)',
    );
    // Ordinary servers resolve overlay-first too, with tenant-cache fallback:
    // github was not in the overlay here, so the cache legitimately served it.
    assert.equal(capture.toolsets?.['github'], tenantGithub);
    assert.ok(consulted.includes('github'));
  });

  it('subagent with NO overlay gets no compass at all — a tenant-cache miss stays a miss (nothing resurrects it)', async () => {
    const capture: { toolsets?: Record<string, unknown> } = {};
    const runtime = fakeRuntime('researcher', ['compass', 'github'], capture);
    const consulted: string[] = [];
    const deps = recordingDeps({ github: { search_issues: {} } }, consulted);

    await runSubagentGenerate({
      runtime,
      deps,
      agentId: 'researcher',
      prompt: 'do the thing',
      threadId: 'subagent-thread-no-overlay',
      resourceId: 'user-1',
      tenantId: 'tenant-1',
      // Even with compass explicitly allowlisted, no overlay ⇒ no compass:
      // the cache cannot contain it, and there is no other source.
      scopedMcpServers: ['compass', 'github'],
    });

    assert.deepEqual(Object.keys(capture.toolsets ?? {}), ['github']);
    assert.ok(
      consulted.includes('compass'),
      'the (compass-less) cache was consulted and correctly missed',
    );
  });

  it('overlay entries denied by the allowlist are still dropped (overlay never widens scoping)', async () => {
    const capture: { toolsets?: Record<string, unknown> } = {};
    const runtime = fakeRuntime('researcher', ['compass', 'github'], capture);
    const deps = { mcpToolsets: { github: { search_issues: {} } } };

    await runSubagentGenerate({
      runtime,
      deps,
      agentId: 'researcher',
      prompt: 'do the thing',
      threadId: 'subagent-thread-overlay-denied',
      resourceId: 'user-1',
      tenantId: 'tenant-1',
      // Parent turn had a pooled compass — but compass is NOT in the
      // dispatching allowlist (e.g. explicit mcpEnabled off suppressed it).
      scopedMcpServers: ['github'],
      overlayToolsets: { compass: { get_schedule_rows: {} } },
    });

    assert.deepEqual(Object.keys(capture.toolsets ?? {}), ['github']);
  });
});

// Provenance inheritance (security review F5). The parent turn's project pin
// must reach the subagent's requestContext: table tools read `projectPin` /
// `tenantProjects` from there, and with a null pin `isProjectPinMismatch`
// goes inert — a subagent dispatched from a shangzhong-pinned turn could read
// a guolu-stamped workspace sheet and hand the rows back to the parent,
// laundering the refusal the parent itself would have hit.
describe('runSubagentGenerate provenance inheritance (F5)', () => {
  function captureCtxRuntime(agentId: string, capture: { ctx?: { get(k: string): unknown } }) {
    return {
      definitions: new Map([[agentId, { definition: { mcpServers: [] } }]]),
      getAgent: () => ({
        generate: async (
          _prompt: string,
          opts: { requestContext?: { get(k: string): unknown } },
        ) => {
          capture.ctx = opts.requestContext;
          return { text: 'ok' };
        },
      }),
    } as unknown as Runtime;
  }

  it("inherits the dispatching turn's projectPin and tenantProjects", async () => {
    const capture: { ctx?: { get(k: string): unknown } } = {};
    const projects = [{ id: 'proj-guolu', sources: ['guolu'] }];
    await runSubagentGenerate({
      runtime: captureCtxRuntime('researcher', capture),
      deps: { mcpToolsets: {} },
      agentId: 'researcher',
      prompt: 'do the thing',
      threadId: 'subagent-provenance',
      resourceId: 'user-1',
      tenantId: 'tenant-1',
      projectPin: 'proj-guolu',
      tenantProjects: projects,
    });
    assert.equal(capture.ctx?.get('projectPin'), 'proj-guolu');
    assert.deepEqual(capture.ctx?.get('tenantProjects'), projects);
    // and the subagent marker is still set (no regression)
    assert.equal(capture.ctx?.get('subagentActive'), true);
  });

  it('an unpinned dispatch yields a null pin — the parent posture, not a widening', async () => {
    const capture: { ctx?: { get(k: string): unknown } } = {};
    await runSubagentGenerate({
      runtime: captureCtxRuntime('researcher', capture),
      deps: { mcpToolsets: {} },
      agentId: 'researcher',
      prompt: 'do the thing',
      threadId: 'subagent-unpinned',
      resourceId: 'user-1',
      tenantId: 'tenant-1',
    });
    assert.equal(capture.ctx?.get('projectPin'), null);
    assert.equal(capture.ctx?.get('tenantProjects'), undefined);
  });
});
