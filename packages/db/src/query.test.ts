import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeId } from './query.js';

describe('normalizeId', () => {
  it('strips simple table prefix', () => {
    assert.equal(normalizeId('rule:abc-123'), 'abc-123');
  });

  it('preserves colon-containing ids inside angle brackets', () => {
    assert.equal(
      normalizeId('plugin_install:⟨plugin:00000000-0000-0000-0000-000000000000:hello-veylin⟩'),
      'plugin:00000000-0000-0000-0000-000000000000:hello-veylin',
    );
  });

  it('preserves RecordId object ids that contain colons', () => {
    assert.equal(
      normalizeId({
        tb: 'plugin_install',
        id: 'plugin:00000000-0000-0000-0000-000000000000:hello-veylin',
      }),
      'plugin:00000000-0000-0000-0000-000000000000:hello-veylin',
    );
  });

  it('keeps already-logical multi-colon ids', () => {
    assert.equal(
      normalizeId('plugin:00000000-0000-0000-0000-000000000000:hello-veylin'),
      'plugin:00000000-0000-0000-0000-000000000000:hello-veylin',
    );
  });
});
