import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_AGENT_ID } from './registry.js';

describe('runtime registry', () => {
  it('exports default agent id', () => {
    assert.equal(typeof DEFAULT_AGENT_ID, 'string');
    assert.ok(DEFAULT_AGENT_ID.length > 0);
  });
});
