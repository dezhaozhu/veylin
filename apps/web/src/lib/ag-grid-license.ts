/**
 * AG-Grid Enterprise license + Pro entitlement.
 *
 * The Enterprise license key is your single-application license — the SAME for
 * every user — and is injected by the operator at BUILD time via the
 * `VITE_AG_GRID_LICENSE` env var. End-users never type it in. A localStorage
 * override is still honored (for a self-hoster who brings their own license),
 * but there is intentionally no UI for it.
 *
 * Community (MIT) stays the default: `ag-grid-enterprise` is only dynamically
 * imported at startup when a key is present (see main.tsx), so the no-key build
 * ships pure Community with no Enterprise code and no watermark.
 */

const LS_OVERRIDE = 'veylin-aggrid-license';

/** Returns the Enterprise license key (build-injected, else self-hoster override), or ''. */
export function getAgGridLicenseKey(): string {
  const injected = (import.meta.env?.VITE_AG_GRID_LICENSE as string | undefined) ?? '';
  if (injected) return injected;
  if (typeof window === 'undefined') return '';
  try {
    return localStorage.getItem(LS_OVERRIDE) ?? '';
  } catch {
    return '';
  }
}

/**
 * Whether the current user may use Pro (Enterprise-grade) features such as the
 * 二三级 master-detail schedule view.
 *
 * This is the SINGLE seam to wire to your subscription/entitlement backend
 * (the right source is a per-user/per-tenant flag from Compass, fetched once at
 * login and cached). Until that exists it reads a build flag (`VITE_PRO_FEATURES`)
 * and defaults to ON, so the operator's own deployment has Pro features enabled.
 *
 * Note: Pro features ALSO require the Enterprise key/modules to actually load, so
 * a self-hoster without a key never gets them regardless of this flag.
 */
export function hasProEntitlement(): boolean {
  const flag = (import.meta.env?.VITE_PRO_FEATURES as string | undefined) ?? '';
  if (flag === '') return true; // default on for the operator's build
  return flag === '1' || flag.toLowerCase() === 'true';
}
