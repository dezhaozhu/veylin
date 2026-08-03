import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  clearThreadTodosSnapshot,
  getThreadTodosSnapshot,
  setThreadTodosSnapshot,
} from './thread-todos-store.js';
import {
  clearActivatedSkillsSnapshot,
  getActivatedSkillsSnapshot,
  setActivatedSkillsSnapshot,
} from './activated-skills-store.js';

describe('thread restore stores', () => {
  it('stores todos per thread snapshot', () => {
    clearThreadTodosSnapshot();
    setThreadTodosSnapshot('t1', [
      { id: '1', content: 'a', status: 'pending' },
    ]);
    assert.equal(getThreadTodosSnapshot().threadId, 't1');
    assert.equal(getThreadTodosSnapshot().todos.length, 1);
    clearThreadTodosSnapshot();
    assert.equal(getThreadTodosSnapshot().threadId, undefined);
  });

  it('stores activated skill names sorted', () => {
    clearActivatedSkillsSnapshot();
    setActivatedSkillsSnapshot('t1', ['zeta', 'alpha']);
    assert.deepEqual(getActivatedSkillsSnapshot().skillNames, ['alpha', 'zeta']);
    clearActivatedSkillsSnapshot();
    assert.deepEqual(getActivatedSkillsSnapshot().skillNames, []);
  });
});
