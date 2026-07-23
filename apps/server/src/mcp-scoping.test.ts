import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveScopedMcp } from './mcp-scoping.js';

describe('resolveScopedMcp', () => {
  it('passes ungrouped servers through untouched', () => {
    const result = resolveScopedMcp(['a', 'b'], {}, null);
    assert.deepEqual(result.active, ['a', 'b']);
    assert.equal(result.autoPin, null);
  });

  it('a valid pin keeps only the pinned member of its group', () => {
    const result = resolveScopedMcp(
      ['g1a', 'g1b', 'other'],
      { g1a: 'proj1', g1b: 'proj1' },
      'g1a',
    );
    assert.deepEqual(result.active, ['g1a', 'other']);
    assert.equal(result.autoPin, null);
  });

  it('no pin auto-pins the alphabetically-first active member and filters the rest', () => {
    const result = resolveScopedMcp(
      ['g1b', 'g1a'],
      { g1a: 'proj1', g1b: 'proj1' },
      null,
    );
    assert.deepEqual(result.active, ['g1a']);
    assert.equal(result.autoPin, 'g1a');
  });

  it('a stale pin (not an active member) re-auto-pins the group', () => {
    const result = resolveScopedMcp(
      ['g1a', 'g1b'],
      { g1a: 'proj1', g1b: 'proj1' },
      'g1c', // e.g. disabled or removed
    );
    assert.deepEqual(result.active, ['g1a']);
    assert.equal(result.autoPin, 'g1a');
  });

  it('two groups are constrained independently', () => {
    const groups = { a1: 'A', a2: 'A', b1: 'B', b2: 'B' };
    const result = resolveScopedMcp(['a1', 'a2', 'b1', 'b2'], groups, 'a2');
    assert.deepEqual(result.active, ['a2', 'b1']);
    // Group A resolved via a valid pin; only group B needed auto-pinning.
    assert.equal(result.autoPin, 'b1');
  });

  it('when multiple groups need auto-pinning, only the alphabetically-first group is reported', () => {
    const groups = { z1: 'Z', z2: 'Z', a1: 'A', a2: 'A' };
    const result = resolveScopedMcp(['z1', 'z2', 'a1', 'a2'], groups, null);
    // Both groups auto-pin (each keeps its alphabetically-first member)...
    assert.deepEqual(result.active.sort(), ['a1', 'z1']);
    // ...but autoPin only surfaces group 'A' (alphabetically first group name).
    assert.equal(result.autoPin, 'a1');
  });

  it('a single-member group is kept and reported as auto-pinned when unpinned', () => {
    const result = resolveScopedMcp(['solo', 'other'], { solo: 'onlygroup' }, null);
    assert.deepEqual(result.active, ['solo', 'other']);
    assert.equal(result.autoPin, 'solo');
  });

  it('never empties a group that had active members, even with an unrelated pin', () => {
    const result = resolveScopedMcp(['g1a', 'g1b'], { g1a: 'proj1', g1b: 'proj1' }, 'unrelated');
    assert.equal(result.active.length, 1);
    assert.ok(result.active.includes('g1a'));
  });
});
