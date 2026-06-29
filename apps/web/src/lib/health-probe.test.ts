import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isVeylinHealthReady, probeVeylinHealth } from './health-probe';

describe('health-probe', () => {
  it('isVeylinHealthReady requires ok and db.ready', () => {
    assert.equal(isVeylinHealthReady({ ok: true, db: { ready: true } }), true);
    assert.equal(isVeylinHealthReady({ ok: true, db: { ready: false } }), false);
    assert.equal(isVeylinHealthReady({ ok: false, db: { ready: true } }), false);
    assert.equal(isVeylinHealthReady(null), false);
  });

  it('probeVeylinHealth rejects non-Veylin 200 responses', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response('<html>ok</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    try {
      assert.equal(await probeVeylinHealth('http://127.0.0.1:8787/health'), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('probeVeylinHealth accepts Veylin health JSON', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      Response.json({ ok: true, db: { ready: true } });
    try {
      assert.equal(await probeVeylinHealth('http://127.0.0.1:8787/health'), true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
