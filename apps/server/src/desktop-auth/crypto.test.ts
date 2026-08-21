import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decryptJson, encryptJson } from './crypto.js';

describe('desktop-auth crypto', () => {
  it('round-trips token JSON', () => {
    const blob = encryptJson({ access: 'a-token', refresh: 'r-token' });
    assert.equal(blob.alg, 'aes-256-gcm');
    const out = decryptJson<{ access: string; refresh: string }>(blob);
    assert.equal(out.access, 'a-token');
    assert.equal(out.refresh, 'r-token');
  });

  it('fails decrypt with tampered ciphertext', () => {
    const blob = encryptJson({ access: 'x' });
    blob.ciphertext = Buffer.from('tampered').toString('base64');
    assert.throws(() => decryptJson(blob));
  });
});
