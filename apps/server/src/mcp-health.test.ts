import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildMcpHealthSnapshot } from './mcp-health.js';

describe('buildMcpHealthSnapshot', () => {
  it('marks servers without toolsets as disconnected', () => {
    const snapshot = buildMcpHealthSnapshot(['github'], {}, 'connection refused');
    assert.equal(snapshot.lastError, 'connection refused');
    assert.equal(snapshot.servers[0]?.connected, false);
    assert.equal(snapshot.servers[0]?.lastError, 'connection refused');
  });

  it('counts tools for connected servers', () => {
    const snapshot = buildMcpHealthSnapshot(['github'], {
      github: { search: { description: 'search' }, issues: { description: 'issues' } },
    });
    assert.equal(snapshot.servers[0]?.connected, true);
    assert.equal(snapshot.servers[0]?.toolCount, 2);
  });
});
