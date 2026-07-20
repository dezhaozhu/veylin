import type { IdentityPort, IdentitySession, HeadersLike } from '../types.js';

/**
 * OIDC / bearer stub for enterprise IdP.
 * Validates presence of Bearer token and optionally introspects via IDENTITY_OIDC_INTROSPECTION_URL.
 * Full OIDC login UI / redirect is out of Host scope — customer IdP issues the token.
 */
export function createOidcIdentityPort(): IdentityPort {
  const introspectionUrl = process.env.IDENTITY_OIDC_INTROSPECTION_URL?.trim() ?? '';
  const clientId = process.env.IDENTITY_OIDC_CLIENT_ID?.trim() ?? '';
  const clientSecret = process.env.IDENTITY_OIDC_CLIENT_SECRET?.trim() ?? '';
  const userInfoUrl = process.env.IDENTITY_OIDC_USERINFO_URL?.trim() ?? '';

  return {
    id: 'oidc',
    supportsLocalCredentials: false,
    async getSession(headers: HeadersLike): Promise<IdentitySession | null> {
      const authHeader =
        headers instanceof Headers
          ? headers.get('authorization')
          : Array.isArray(headers.authorization)
            ? headers.authorization[0]
            : headers.authorization;
      if (!authHeader?.toLowerCase().startsWith('bearer ')) return null;
      const token = authHeader.slice(7).trim();
      if (!token) return null;

      if (userInfoUrl) {
        const res = await fetch(userInfoUrl, {
          headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        });
        if (!res.ok) return null;
        const data = (await res.json()) as Record<string, unknown>;
        const userId = String(data.sub ?? data.id ?? '').trim();
        if (!userId) return null;
        return {
          userId,
          email: data.email != null ? String(data.email) : undefined,
          displayName: data.name != null ? String(data.name) : undefined,
        };
      }

      if (introspectionUrl && clientId) {
        const body = new URLSearchParams({ token, token_type_hint: 'access_token' });
        const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        const res = await fetch(introspectionUrl, {
          method: 'POST',
          headers: {
            authorization: `Basic ${basic}`,
            'content-type': 'application/x-www-form-urlencoded',
            accept: 'application/json',
          },
          body,
        });
        if (!res.ok) return null;
        const data = (await res.json()) as Record<string, unknown>;
        if (data.active !== true) return null;
        const userId = String(data.sub ?? data.username ?? '').trim();
        if (!userId) return null;
        return {
          userId,
          email: data.email != null ? String(data.email) : undefined,
          displayName: data.name != null ? String(data.name) : undefined,
        };
      }

      // Dev-friendly fallback: accept opaque bearer as user id when no IdP URLs configured.
      console.warn(
        '[identity] OIDC provider missing USERINFO/INTROSPECTION URL; using bearer token as userId (dev only)',
      );
      return { userId: token.slice(0, 64), displayName: 'OIDC User' };
    },
  };
}
