/** Desktop / embedded mode: single-tenant, no login required. */
export const isDesktopAuth =
  process.env.VEYLIN_DESKTOP_AUTH === '1' || process.env.VEYLIN_SKIP_AUTH === '1';

export function assertHostedAuthConfig(): void {
  if (isDesktopAuth) return;
  if (!process.env.AUTH_SECRET?.trim()) {
    throw new Error(
      'AUTH_SECRET is required when VEYLIN_DESKTOP_AUTH is not enabled (hosted/self-hosted mode)',
    );
  }
}

type SessionUser = { id: string; name?: string | null };
type SessionResult = { user: SessionUser } | null;

export type AuthHandle = {
  api: {
    getSession: (opts: { headers: unknown }) => Promise<SessionResult>;
  };
  handler: (req: Request) => Promise<Response>;
};

let authInstance: AuthHandle | null | undefined;

export function getAuth(): AuthHandle | null {
  if (isDesktopAuth) return null;
  if (authInstance !== undefined) return authInstance;
  // Lazy init is handled in server boot for full better-auth when needed.
  return null;
}

export function setAuth(instance: AuthHandle | null): void {
  authInstance = instance;
}

/** Back-compat export used by server routes. */
export const auth = {
  get api() {
    const a = getAuth();
    return (
      a?.api ?? {
        getSession: async () => null,
      }
    );
  },
  get handler() {
    const a = getAuth();
    if (!a) {
      return async () => new Response('Auth disabled', { status: 404 });
    }
    return a.handler;
  },
};

export type AuthSession = SessionResult;
