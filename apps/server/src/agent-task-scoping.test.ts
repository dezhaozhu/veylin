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
