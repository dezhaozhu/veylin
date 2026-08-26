import type { EntitlementsSnapshot, PlatformUserSummary, TokenPair } from './session-store.js';

export function getPlatformBaseUrl(): string | null {
  const raw =
    process.env.VEYLIN_PLATFORM_URL?.trim() ||
    process.env.VEYLIN_PLATFORM_AUTH_URL?.trim() ||
    '';
  if (!raw) return null;
  return raw.replace(/\/$/, '');
}

export function isPlatformAuthConfigured(): boolean {
  return Boolean(getPlatformBaseUrl());
}

function platformUrl(path: string): string {
  const base = getPlatformBaseUrl();
  if (!base) throw new Error('VEYLIN_PLATFORM_URL is not configured');
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalized}`;
}

export class PlatformApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'PlatformApiError';
    this.status = status;
    this.body = body;
  }
}

function messageFromBody(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback;
  const obj = body as Record<string, unknown>;
  if (typeof obj.detail === 'string') return obj.detail;
  if (Array.isArray(obj.non_field_errors) && typeof obj.non_field_errors[0] === 'string') {
    return obj.non_field_errors[0];
  }
  for (const key of ['username', 'password', 'refresh', 'access']) {
    const v = obj[key];
    if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
    if (typeof v === 'string') return v;
  }
  return fallback;
}

async function parseJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export type PlatformTokenResponse = TokenPair & { user: PlatformUserSummary };

export async function platformLogin(
  username: string,
  password: string,
): Promise<PlatformTokenResponse> {
  const res = await fetch(platformUrl('/api/v1/desktop/auth/login/'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await parseJson(res);
  if (!res.ok) {
    throw new PlatformApiError(
      res.status,
      messageFromBody(body, '用户名或密码错误'),
      body,
    );
  }
  return body as PlatformTokenResponse;
}

export async function platformRefresh(refresh: string): Promise<PlatformTokenResponse> {
  const res = await fetch(platformUrl('/api/v1/desktop/auth/refresh/'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ refresh }),
  });
  const body = await parseJson(res);
  if (!res.ok) {
    throw new PlatformApiError(res.status, messageFromBody(body, '刷新令牌无效'), body);
  }
  return body as PlatformTokenResponse;
}

export async function platformLogout(refresh: string): Promise<void> {
  const res = await fetch(platformUrl('/api/v1/desktop/auth/logout/'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ refresh }),
  });
  if (res.status === 204 || res.ok) return;
  const body = await parseJson(res);
  throw new PlatformApiError(res.status, messageFromBody(body, '登出失败'), body);
}

export async function platformMe(access: string): Promise<PlatformUserSummary> {
  const res = await fetch(platformUrl('/api/v1/desktop/auth/me/'), {
    method: 'GET',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${access}`,
    },
  });
  const body = await parseJson(res);
  if (!res.ok) {
    throw new PlatformApiError(res.status, messageFromBody(body, '获取用户失败'), body);
  }
  return body as PlatformUserSummary;
}

export async function platformEntitlements(access: string): Promise<EntitlementsSnapshot> {
  const res = await fetch(platformUrl('/api/v1/desktop/entitlements/'), {
    method: 'GET',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${access}`,
    },
  });
  const body = await parseJson(res);
  if (!res.ok) {
    throw new PlatformApiError(res.status, messageFromBody(body, '拉取权限失败'), body);
  }
  return body as EntitlementsSnapshot;
}
