import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deriveFinalOutput, type WorkflowRunLogEntry } from './workflow.js';

describe('deriveFinalOutput', () => {
  it('prefers end node output', () => {
    const log: WorkflowRunLogEntry[] = [
      { nodeId: 'n1', kind: 'start', status: 'ok', message: 'ok', at: '1', output: { event: {} } },
      { nodeId: 'n2', kind: 'run_agent', status: 'ok', message: 'ok', at: '2', output: { text: 'hi' } },
      { nodeId: 'n3', kind: 'end', status: 'ok', message: 'ok', at: '3', output: { outputs: { reply: 'hi' } } },
    ];
    assert.deepEqual(deriveFinalOutput(log), { outputs: { reply: 'hi' } });
  });

  it('falls back to last ok step when no end', () => {
    const log: WorkflowRunLogEntry[] = [
      { nodeId: 'n2', kind: 'run_agent', status: 'ok', message: 'ok', at: '2', output: { text: 'hello' } },
    ];
    assert.deepEqual(deriveFinalOutput(log), { text: 'hello' });
  });
});
