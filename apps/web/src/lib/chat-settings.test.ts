import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveGroupToggleState } from './chat-settings';

test('resolveGroupToggleState: uniform on (default/unset) stays on, no heal', () => {
  const result = resolveGroupToggleState([
    { name: 'compass', enabled: true },
    { name: 'compass-guolu', enabled: true },
  ]);
  assert.equal(result.enabled, true);
  assert.deepEqual(result.membersToHeal, []);
});

test('resolveGroupToggleState: uniform off is a legitimate explicit off, no heal', () => {
  const result = resolveGroupToggleState([
    { name: 'compass', enabled: false },
    { name: 'compass-guolu', enabled: false },
  ]);
  assert.equal(result.enabled, false);
  assert.deepEqual(result.membersToHeal, []);
});

test('resolveGroupToggleState: mixed legacy state reads as ON and flags the off members for healing', () => {
  // The bug: legacy radio-belt state like {"compass": false, "compass-guolu": true}.
  const result = resolveGroupToggleState([
    { name: 'compass', enabled: false },
    { name: 'compass-guolu', enabled: true },
  ]);
  assert.equal(result.enabled, true);
  assert.deepEqual(result.membersToHeal, ['compass']);
});

test('resolveGroupToggleState: mixed state with several off members heals all of them', () => {
  const result = resolveGroupToggleState([
    { name: 'compass', enabled: false },
    { name: 'compass-guolu', enabled: true },
    { name: 'compass-shangzhong', enabled: false },
  ]);
  assert.equal(result.enabled, true);
  assert.deepEqual(result.membersToHeal.sort(), ['compass', 'compass-shangzhong']);
});

test('resolveGroupToggleState: single member (v3 single compass entry) resolves to its own value, never heals', () => {
  // Post-cutover reality: the compass-proj group has the single member 'compass'.
  const on = resolveGroupToggleState([{ name: 'compass', enabled: true }]);
  assert.equal(on.enabled, true);
  assert.deepEqual(on.membersToHeal, []);

  const off = resolveGroupToggleState([{ name: 'compass', enabled: false }]);
  assert.equal(off.enabled, false);
  assert.deepEqual(off.membersToHeal, []);
});

test('resolveGroupToggleState: empty group is enabled with nothing to heal', () => {
  const result = resolveGroupToggleState([]);
  assert.equal(result.enabled, true);
  assert.deepEqual(result.membersToHeal, []);
});
