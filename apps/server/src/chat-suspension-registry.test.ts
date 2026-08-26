import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  clearSuspendedRunsForTest,
  consumeSuspendedRun,
  observeSuspensionChunk,
  registerSuspendedRun,
} from './chat-suspension-registry';

const owner = {
  threadId: 'thread-1',
  tenantId: 'tenant-1',
  resourceOwnerId: 'user-1',
  agentId: 'agent-1',
};

afterEach(() => clearSuspendedRunsForTest());

describe('chat suspension registry', () => {
  it('observes and atomically consumes the exact suspended tool call', () => {
    const chunk: {
      type: string;
      data: {
        runId: string;
        toolCallId: string;
        suspendPayload: { questions: never[] };
        suspendedAt?: number;
      };
    } = {
      type: 'data-tool-call-suspended',
      data: {
        runId: 'run-1',
        toolCallId: 'call-1',
        suspendPayload: { questions: [] },
      },
    };
    assert.equal(observeSuspensionChunk(chunk, owner), chunk);
    assert.equal(typeof chunk.data.suspendedAt, 'number');
    const consumed = consumeSuspendedRun(owner, 'run-1', 'call-1');
    assert.ok(consumed);
    assert.deepEqual(
      { ...consumed, createdAt: 0 },
      {
      ...owner,
      runId: 'run-1',
      toolCallId: 'call-1',
      suspendPayload: { questions: [] },
        createdAt: 0,
      },
    );
    assert.equal(consumed.createdAt, chunk.data.suspendedAt);
    assert.equal(consumeSuspendedRun(owner, 'run-1', 'call-1'), null);
  });

  it('rejects a different owner or tool call without consuming the record', () => {
    registerSuspendedRun({
      ...owner,
      runId: 'run-1',
      toolCallId: 'call-1',
      suspendPayload: null,
      createdAt: Date.now(),
    });
    assert.equal(
      consumeSuspendedRun({ ...owner, resourceOwnerId: 'other-user' }, 'run-1', 'call-1'),
      null,
    );
    assert.equal(consumeSuspendedRun(owner, 'run-1', 'other-call'), null);
    assert.ok(consumeSuspendedRun(owner, 'run-1', 'call-1'));
  });

  it('hydrates a durable record after an in-process registry reset', () => {
    const persisted = {
      ...owner,
      runId: 'run-1',
      toolCallId: 'call-1',
      suspendPayload: { tabId: 'tab-1' },
      createdAt: Date.now(),
    };
    clearSuspendedRunsForTest();
    registerSuspendedRun(persisted);
    assert.deepEqual(consumeSuspendedRun(owner, 'run-1', 'call-1'), persisted);
  });

  it('does not rehydrate a consumed durable record, but accepts the next suspension', () => {
    const persisted = {
      ...owner,
      runId: 'run-1',
      toolCallId: 'call-1',
      suspendPayload: null,
      createdAt: Date.now(),
    };
    registerSuspendedRun(persisted);
    assert.ok(consumeSuspendedRun(owner, 'run-1', 'call-1'));
    registerSuspendedRun(persisted);
    assert.equal(consumeSuspendedRun(owner, 'run-1', 'call-1'), null);

    observeSuspensionChunk(
      {
        type: 'data-tool-call-suspended',
        data: { runId: 'run-1', toolCallId: 'call-2', suspendPayload: null },
      },
      owner,
    );
    assert.ok(consumeSuspendedRun(owner, 'run-1', 'call-2'));
  });
});
