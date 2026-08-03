import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveResumeCursor } from './resumable-chat-stream.js';

describe('resolveResumeCursor', () => {
  it('prefers Last-Event-ID over query param', () => {
    assert.equal(resolveResumeCursor('seq-42', '1'), 'seq-42');
  });

  it('falls back to from_sequence_num query as base36', () => {
    assert.equal(resolveResumeCursor(undefined, '7'), '7');
  });

  it('defaults to empty cursor', () => {
    assert.equal(resolveResumeCursor(undefined, undefined), '');
  });
});
