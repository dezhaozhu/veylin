import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatTaskNotification,
  parseLegacySubagentWriteback,
  parseTaskNotification,
} from './task-notification';

describe('task-notification', () => {
  it('round-trips structured notifications', () => {
    const original = {
      taskId: 'task-abc',
      status: 'completed' as const,
      summary: 'Agent "explore" completed',
      result: 'Found auth.ts',
      subagent_type: 'explore',
      usage: { total_tokens: 1200, duration_ms: 4500 },
    };
    const text = formatTaskNotification(original);
    const parsed = parseTaskNotification(text);
    assert.deepEqual(parsed, original);
  });

  it('parses legacy writeback', () => {
    const legacy = parseLegacySubagentWriteback('[subagent:explore]\nFound files');
    assert.equal(legacy?.label, 'explore');
    assert.equal(legacy?.body, 'Found files');
  });
});
