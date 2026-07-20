import type { IdentityPort, IdentitySession, HeadersLike } from '../types.js';
import type { AuthHandle } from '../../auth.js';

function toFetchHeaders(headers: HeadersLike): Headers {
  if (headers instanceof Headers) return headers;
  const h = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const v of value) h.append(key, v);
    } else {
      h.set(key, value);
    }
  }
  return h;
}

/**
 * Local email/password via better-auth (persistent SQLite).
 * Sign-up/sign-in go through /api/auth/*; this port reads sessions.
 */
export function createLocalPasswordIdentityPort(getAuthHandle: () => AuthHandle | null): IdentityPort {
  return {
    id: 'local',
    supportsLocalCredentials: true,
    async getSession(headers: HeadersLike): Promise<IdentitySession | null> {
      const auth = getAuthHandle();
      if (!auth) return null;
      try {
        const session = await auth.api.getSession({ headers: toFetchHeaders(headers) as never });
        if (!session?.user) return null;
        return {
          userId: session.user.id,
          email: (session.user as { email?: string }).email,
          displayName: session.user.name ?? undefined,
        };
      } catch {
        return null;
      }
    },
  };
}
