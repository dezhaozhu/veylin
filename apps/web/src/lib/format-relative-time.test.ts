import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatRelativeTimeShort } from './format-relative-time.js';

describe('formatRelativeTimeShort', () => {
  const now = Date.parse('2026-07-11T01:00:00.000Z');

  it('floors sub-minute ages to 1m', () => {
    assert.equal(formatRelativeTimeShort(new Date(now - 15_000), now), '1m');
    assert.equal(formatRelativeTimeShort(new Date(now), now), '1m');
  });

  it('shows minutes then hours then days', () => {
    assert.equal(formatRelativeTimeShort(new Date(now - 60_000), now), '1m');
    assert.equal(formatRelativeTimeShort(new Date(now - 59 * 60_000), now), '59m');
    assert.equal(formatRelativeTimeShort(new Date(now - 2 * 60 * 60_000), now), '2h');
    assert.equal(formatRelativeTimeShort(new Date(now - 2 * 86_400_000), now), '2d');
  });
});
