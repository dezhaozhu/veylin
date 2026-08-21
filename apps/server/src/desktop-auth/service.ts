import { getOrCreateInstallId } from './install-id.js';
import {
  isPlatformAuthConfigured,
  platformEntitlements,
  platformLogin,
  platformLogout,
  platformRefresh,
  PlatformApiError,
} from './platform-client.js';
import {
  clearSessionTokensAndUser,
  readDecryptedTokens,
  readSessionFile,
  setEncryptedTokens,
  writeSessionFile,
  type DesktopSessionFile,
  type EntitlementsSnapshot,
  type PlatformUserSummary,
} from './session-store.js';

/** Entitlements older than this should be refreshed on demand (design Q4). */
export const ENTITLEMENTS_STALE_MS = 120_000;
/** Background refresh interval (design Q4). */
export const ENTITLEMENTS_INTERVAL_MS = 5 * 60_000;

export type PublicDesktopSession = {
  enabled: boolean;
  configured: boolean;
  installId: string;
  loggedIn: boolean;
  user: PlatformUserSummary | null;
  /** Present for debugging / future UI; not shown in product UI this phase. */
  entitlements: EntitlementsSnapshot | null;
  entitlementsFetchedAt: string | null;
  entitlementsAgeMs: number | null;
};

function entitlementsAgeMs(session: DesktopSessionFile): number | null {
  if (!session.entitlementsFetchedAt) return null;
  const t = Date.parse(session.entitlementsFetchedAt);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Date.now() - t);
}

function toPublic(session: DesktopSessionFile): PublicDesktopSession {
  const age = entitlementsAgeMs(session);
  return {
    enabled: true,
    configured: isPlatformAuthConfigured(),
    installId: getOrCreateInstallId(),
    loggedIn: Boolean(session.user && session.tokens),
    user: session.user,
    entitlements: session.entitlements,
    entitlementsFetchedAt: session.entitlementsFetchedAt,
    entitlementsAgeMs: age,
  };
}

export function getPublicDesktopSession(): PublicDesktopSession {
  return toPublic(readSessionFile());
}

export function getDesktopAuthStatus(): {
  enabled: boolean;
  configured: boolean;
  provider: string | null;
} {
  const configured = isPlatformAuthConfigured();
  return {
    enabled: true,
    configured,
    provider: configured ? 'veylin-platform' : null,
  };
}

async function fetchAndStoreEntitlements(
  session: DesktopSessionFile,
  access: string,
): Promise<DesktopSessionFile> {
  const entitlements = await platformEntitlements(access);
  const next: DesktopSessionFile = {
    ...session,
    entitlements,
    entitlementsFetchedAt: new Date().toISOString(),
  };
  writeSessionFile(next);
  return next;
}

/**
 * Ensure we can obtain an access token, refreshing once on failure paths used by
 * entitlements. Returns null if logged out / unrecoverable.
 */
async function withRefreshedAccess<T>(
  run: (access: string) => Promise<T>,
): Promise<{ ok: true; value: T; session: DesktopSessionFile } | { ok: false }> {
  let session = readSessionFile();
  let tokens = readDecryptedTokens(session);
  if (!tokens) return { ok: false };

  try {
    const value = await run(tokens.access);
    return { ok: true, value, session };
  } catch (err) {
    if (!(err instanceof PlatformApiError) || (err.status !== 401 && err.status !== 403)) {
      throw err;
    }
  }

  try {
    const refreshed = await platformRefresh(tokens.refresh);
    session = setEncryptedTokens(
      {
        ...session,
        user: refreshed.user ?? session.user,
      },
      { access: refreshed.access, refresh: refreshed.refresh },
    );
    writeSessionFile(session);
    tokens = { access: refreshed.access, refresh: refreshed.refresh };
    const value = await run(tokens.access);
    return { ok: true, value, session: readSessionFile() };
  } catch (err) {
    console.warn('[desktop-auth] token refresh/retry failed; clearing session', err);
    clearSessionTokensAndUser();
    return { ok: false };
  }
}

/** Pull entitlements if missing or older than 120s (or force). */
export async function refreshEntitlementsIfNeeded(
  opts: { force?: boolean } = {},
): Promise<PublicDesktopSession> {
  if (!isPlatformAuthConfigured()) return getPublicDesktopSession();

  const session = readSessionFile();
  if (!session.user || !session.tokens) return toPublic(session);

  const age = entitlementsAgeMs(session);
  const stale = age === null || age > ENTITLEMENTS_STALE_MS;
  if (!opts.force && !stale && session.entitlements) {
    return toPublic(session);
  }

  const result = await withRefreshedAccess((access) => platformEntitlements(access));
  if (!result.ok) return getPublicDesktopSession();

  const next: DesktopSessionFile = {
    ...result.session,
    entitlements: result.value,
    entitlementsFetchedAt: new Date().toISOString(),
  };
  writeSessionFile(next);
  return toPublic(next);
}

export async function loginWithPassword(
  username: string,
  password: string,
): Promise<PublicDesktopSession> {
  if (!isPlatformAuthConfigured()) {
    throw new PlatformApiError(503, '未配置 VEYLIN_PLATFORM_URL');
  }
  const pair = await platformLogin(username.trim(), password);
  let session: DesktopSessionFile = setEncryptedTokens(
    {
      version: 1,
      user: pair.user,
      entitlements: null,
      entitlementsFetchedAt: null,
      tokens: null,
      updatedAt: new Date().toISOString(),
    },
    { access: pair.access, refresh: pair.refresh },
  );
  writeSessionFile(session);

  try {
    session = await fetchAndStoreEntitlements(session, pair.access);
  } catch (err) {
    console.warn('[desktop-auth] entitlements fetch after login failed:', err);
  }

  return toPublic(readSessionFile());
}

export async function logoutDesktopSession(): Promise<PublicDesktopSession> {
  const session = readSessionFile();
  const tokens = readDecryptedTokens(session);
  if (tokens?.refresh && isPlatformAuthConfigured()) {
    try {
      await platformLogout(tokens.refresh);
    } catch (err) {
      console.warn('[desktop-auth] platform logout failed (clearing local anyway):', err);
    }
  }
  clearSessionTokensAndUser();
  return getPublicDesktopSession();
}

/** Session for UI: refresh entitlements when stale (>120s). */
export async function loadSessionForClient(): Promise<PublicDesktopSession> {
  getOrCreateInstallId();
  return refreshEntitlementsIfNeeded({ force: false });
}

let entitlementsTimer: ReturnType<typeof setInterval> | null = null;

export function startEntitlementsRefreshLoop(): void {
  if (entitlementsTimer) return;
  if (!isPlatformAuthConfigured()) {
    console.info('[desktop-auth] entitlements loop skipped (no VEYLIN_PLATFORM_URL)');
    return;
  }
  entitlementsTimer = setInterval(() => {
    void refreshEntitlementsIfNeeded({ force: true }).catch((err) => {
      console.warn('[desktop-auth] periodic entitlements refresh failed:', err);
    });
  }, ENTITLEMENTS_INTERVAL_MS);
  // Avoid keeping the process alive solely for this timer in some runtimes
  if (typeof entitlementsTimer === 'object' && 'unref' in entitlementsTimer) {
    entitlementsTimer.unref();
  }
  console.info(
    `[desktop-auth] entitlements refresh every ${ENTITLEMENTS_INTERVAL_MS / 1000}s`,
  );
}

export function stopEntitlementsRefreshLoop(): void {
  if (entitlementsTimer) {
    clearInterval(entitlementsTimer);
    entitlementsTimer = null;
  }
}
