import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { getAgGridLicenseKey, hasProEntitlement } from './ag-grid-license';

// node:test has no browser globals. The key now comes from VITE_AG_GRID_LICENSE
// (build-injected, absent here) with a localStorage override fallback; entitlement
// reads VITE_PRO_FEATURES (absent here → defaults on). We exercise the fallback +
// default paths.
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string): string | null => store[key] ?? null,
  setItem: (key: string, value: string): void => {
    store[key] = value;
  },
  removeItem: (key: string): void => {
    delete store[key];
  },
  clear: (): void => {
    for (const k of Object.keys(store)) delete store[k];
  },
};
Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  configurable: true,
});
Object.defineProperty(globalThis, 'window', {
  value: {},
  configurable: true,
});

describe('ag-grid-license', () => {
  beforeEach(() => localStorageMock.clear());

  it('returns empty string when no key is injected or stored', () => {
    assert.equal(getAgGridLicenseKey(), '');
  });

  it('honors a self-hoster localStorage override when no key is build-injected', () => {
    localStorageMock.setItem('veylin-aggrid-license', 'OVERRIDE-KEY');
    assert.equal(getAgGridLicenseKey(), 'OVERRIDE-KEY');
  });

  it('grants Pro entitlement by default (operator build, flag unset)', () => {
    assert.equal(hasProEntitlement(), true);
  });
});
