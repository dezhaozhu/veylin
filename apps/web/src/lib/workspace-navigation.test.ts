import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EMPTY_NAV,
  MAX_NAV_ENTRIES,
  locationsEqual,
  pushLocation,
  reconcileNav,
} from './workspace-navigation';

describe('workspace-navigation', () => {
  it('deduplicates consecutive identical locations', () => {
    const chatA = { view: 'chat' as const, threadId: 'a' };
    const nav = pushLocation(EMPTY_NAV, chatA);
    const next = pushLocation(nav, { ...chatA, threadTitle: 'Renamed' });
    assert.equal(next.entries.length, 1);
    assert.equal(next.index, 0);
  });

  it('truncates forward branch on new navigation', () => {
    const a = { view: 'chat' as const, threadId: 'a' };
    const b = { view: 'chat' as const, threadId: 'b' };
    const settings = { view: 'settings' as const, tab: 'general' as const };
    let nav = pushLocation(EMPTY_NAV, a);
    nav = pushLocation(nav, b);
    nav = { ...nav, index: 0 };
    nav = pushLocation(nav, settings);
    assert.deepEqual(
      nav.entries.map((entry) => ('threadId' in entry ? entry.threadId : entry.view)),
      ['a', 'settings'],
    );
    assert.equal(nav.index, 1);
  });

  it('caps history length', () => {
    let nav = EMPTY_NAV;
    for (let i = 0; i < MAX_NAV_ENTRIES + 5; i += 1) {
      nav = pushLocation(nav, { view: 'chat', threadId: String(i) });
    }
    assert.equal(nav.entries.length, MAX_NAV_ENTRIES);
    assert.equal(nav.index, MAX_NAV_ENTRIES - 1);
  });

  it('reconcileNav aligns index with current location when present', () => {
    const a = { view: 'chat' as const, threadId: 'a' };
    const b = { view: 'customize' as const, tab: 'rules' as const };
    let nav = pushLocation(EMPTY_NAV, a);
    nav = pushLocation(nav, b);
    const reconciled = reconcileNav(nav, a);
    assert.equal(reconciled.index, 0);
    assert.ok(locationsEqual(reconciled.entries[0]!, a));
  });
});
