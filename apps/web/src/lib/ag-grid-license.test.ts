import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { getAgGridLicenseKey, setAgGridLicenseKey } from './ag-grid-license';

// Set up localStorage + window mocks for node:test (no browser globals).
// The implementation guards on `typeof window === 'undefined'` at call time,
// so setting these up before any test function runs is sufficient.
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
  value: {
    dispatchEvent: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  },
  configurable: true,
});

describe('ag-grid-license', () => {
  beforeEach(() => localStorageMock.clear());

  it('returns empty string when no key is stored', () => {
    assert.equal(getAgGridLicenseKey(), '');
  });

  it('round-trips the key via localStorage', () => {
    assert.equal(getAgGridLicenseKey(), '');
    setAgGridLicenseKey('LICENSE-XYZ');
    assert.equal(getAgGridLicenseKey(), 'LICENSE-XYZ');
  });

  it('overwriting the key returns the new value', () => {
    setAgGridLicenseKey('KEY-A');
    setAgGridLicenseKey('KEY-B');
    assert.equal(getAgGridLicenseKey(), 'KEY-B');
  });
});
