import type { IdentityPort, IdentitySession, HeadersLike } from '../types.js';

function headerValue(headers: HeadersLike, name: string): string | undefined {
  if (headers instanceof Headers) {
    return headers.get(name) ?? headers.get(name.toLowerCase()) ?? undefined;
  }
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

/**
 * Webhook session: GET IDENTITY_WEBHOOK_URL with forwarded cookies/Authorization.
 * Expects JSON `{ user: { id, email?, name? } }` or `{ userId, email?, displayName? }`.
 */
export function createWebhookIdentityPort(): IdentityPort {
  const url = process.env.IDENTITY_WEBHOOK_URL?.trim() ?? '';
  return {
    id: 'webhook',
    supportsLocalCredentials: false,
    async getSession(headers: HeadersLike): Promise<IdentitySession | null> {
      if (!url) {
        console.warn('[identity] IDENTITY_PROVIDER=webhook but IDENTITY_WEBHOOK_URL is empty');
        return null;
      }
      const cookie = headerValue(headers, 'cookie');
      const authorization = headerValue(headers, 'authorization');
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          ...(cookie ? { cookie } : {}),
          ...(authorization ? { authorization } : {}),
          accept: 'application/json',
        },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as Record<string, unknown>;
      const user = (data.user as Record<string, unknown> | undefined) ?? data;
      const userId = String(user.id ?? user.userId ?? '').trim();
      if (!userId) return null;
      return {
        userId,
        email: user.email != null ? String(user.email) : undefined,
        displayName:
          user.name != null
            ? String(user.name)
            : user.displayName != null
              ? String(user.displayName)
              : undefined,
      };
    },
  };
}
