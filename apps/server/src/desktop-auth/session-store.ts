import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { decryptJson, encryptJson, type EncryptedBlob } from './crypto.js';
import { sessionPath } from './paths.js';

export type PlatformUserSummary = {
  id: number;
  username: string;
  display_name: string;
  email: string;
  is_active?: boolean;
  is_staff?: boolean;
};

export type EntitlementsSnapshot = {
  roles: Array<{ code: string; name: string }>;
  permissions: Array<{ type: string; code: string }>;
  system_mcps: Array<{
    code: string;
    name: string;
    enabled: boolean;
    transport: string;
    url: string;
  }>;
};

export type TokenPair = {
  access: string;
  refresh: string;
};

export type DesktopSessionFile = {
  version: 1;
  user: PlatformUserSummary | null;
  entitlements: EntitlementsSnapshot | null;
  entitlementsFetchedAt: string | null;
  tokens: EncryptedBlob | null;
  updatedAt: string;
};

function emptySession(): DesktopSessionFile {
  return {
    version: 1,
    user: null,
    entitlements: null,
    entitlementsFetchedAt: null,
    tokens: null,
    updatedAt: new Date().toISOString(),
  };
}

export function readSessionFile(): DesktopSessionFile {
  const path = sessionPath();
  if (!existsSync(path)) return emptySession();
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as DesktopSessionFile;
    if (raw?.version !== 1) return emptySession();
    return {
      version: 1,
      user: raw.user ?? null,
      entitlements: raw.entitlements ?? null,
      entitlementsFetchedAt: raw.entitlementsFetchedAt ?? null,
      tokens: raw.tokens ?? null,
      updatedAt: raw.updatedAt ?? new Date().toISOString(),
    };
  } catch {
    return emptySession();
  }
}

export function writeSessionFile(session: DesktopSessionFile): void {
  const next: DesktopSessionFile = {
    ...session,
    version: 1,
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(sessionPath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

export function clearSessionTokensAndUser(): DesktopSessionFile {
  const cleared = emptySession();
  writeSessionFile(cleared);
  return cleared;
}

/** Delete session file entirely (install-id is kept). */
export function deleteSessionFile(): void {
  const path = sessionPath();
  if (existsSync(path)) unlinkSync(path);
}

export function setEncryptedTokens(session: DesktopSessionFile, tokens: TokenPair): DesktopSessionFile {
  return {
    ...session,
    tokens: encryptJson(tokens),
  };
}

export function readDecryptedTokens(session: DesktopSessionFile): TokenPair | null {
  if (!session.tokens) return null;
  try {
    const pair = decryptJson<TokenPair>(session.tokens);
    if (!pair?.access || !pair?.refresh) return null;
    return pair;
  } catch (err) {
    console.warn('[desktop-auth] failed to decrypt tokens:', err);
    return null;
  }
}
