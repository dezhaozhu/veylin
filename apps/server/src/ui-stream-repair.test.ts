import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createUiStreamRepairState, repairUiStreamChunk } from './ui-stream-repair.js';

describe('ui-stream-repair', () => {
  it('passes through a normal reasoning sequence', () => {
    const state = createUiStreamRepairState();
    assert.deepEqual(
      repairUiStreamChunk({ type: 'reasoning-start', id: 'reasoning-0' }, state),
      [{ type: 'reasoning-start', id: 'reasoning-0' }],
    );
    assert.deepEqual(
      repairUiStreamChunk({ type: 'reasoning-delta', id: 'reasoning-0', delta: 'a' }, state),
      [{ type: 'reasoning-delta', id: 'reasoning-0', delta: 'a' }],
    );
    assert.deepEqual(
      repairUiStreamChunk({ type: 'reasoning-end', id: 'reasoning-0' }, state),
      [{ type: 'reasoning-end', id: 'reasoning-0' }],
    );
  });

  it('inserts reasoning-start when a later step reuses the same id', () => {
    const state = createUiStreamRepairState();
    repairUiStreamChunk({ type: 'reasoning-start', id: 'reasoning-0' }, state);
    repairUiStreamChunk({ type: 'reasoning-end', id: 'reasoning-0' }, state);
    assert.deepEqual(
      repairUiStreamChunk({ type: 'reasoning-delta', id: 'reasoning-0', delta: 'b' }, state),
      [
        { type: 'reasoning-start', id: 'reasoning-0' },
        { type: 'reasoning-delta', id: 'reasoning-0', delta: 'b' },
      ],
    );
  });

  it('clears reasoning state on step-start', () => {
    const state = createUiStreamRepairState();
    repairUiStreamChunk({ type: 'reasoning-start', id: 'reasoning-0' }, state);
    repairUiStreamChunk({ type: 'step-start' }, state);
    assert.deepEqual(
      repairUiStreamChunk({ type: 'reasoning-end', id: 'reasoning-0' }, state),
      [
        { type: 'reasoning-start', id: 'reasoning-0' },
        { type: 'reasoning-end', id: 'reasoning-0' },
      ],
    );
  });
});
