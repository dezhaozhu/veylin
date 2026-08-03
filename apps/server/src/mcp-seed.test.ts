import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseMcpServersFromEnv } from './mcp-store.js';

describe('parseMcpServersFromEnv', () => {
  it('returns empty array for blank env', () => {
    assert.deepEqual(parseMcpServersFromEnv(''), []);
    assert.deepEqual(parseMcpServersFromEnv('   '), []);
  });

  it('parses valid server entries', () => {
    const raw = JSON.stringify([
      { name: 'compass', transport: 'sse', url: 'https://mcp.compass-work.com/mcp/' },
    ]);
    const parsed = parseMcpServersFromEnv(raw);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.name, 'compass');
    assert.equal(parsed[0]?.transport, 'sse');
  });

  it('skips invalid entries', () => {
    const raw = JSON.stringify([
      { name: 'compass', transport: 'sse', url: 'https://mcp.compass-work.com/mcp/' },
      { name: '', transport: 'sse', url: 'not-a-url' },
    ]);
    assert.equal(parseMcpServersFromEnv(raw).length, 1);
  });

  it('returns empty array for invalid JSON', () => {
    assert.deepEqual(parseMcpServersFromEnv('{bad json'), []);
  });
});
