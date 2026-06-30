/**
 * AG-Grid Enterprise license key — stored in localStorage, broadcast on change.
 * Community (MIT) is the default; Enterprise is loaded dynamically at startup
 * only when a non-empty key is present (see main.tsx). The key is never shipped
 * in the default bundle.
 */

const KEY = 'veylin-aggrid-license';
const EVENT = 'veylin-aggrid-license';

/** Returns the stored license key, or '' if none is set. */
export function getAgGridLicenseKey(): string {
  if (typeof window === 'undefined') return '';
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

/** Persists the license key and notifies listeners. Pass '' to clear. */
export function setAgGridLicenseKey(key: string): void {
  localStorage.setItem(KEY, key);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: key }));
}

/** Subscribe to license-key changes; returns an unsubscribe function. */
export function onAgGridLicenseChange(cb: (key: string) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<string>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
