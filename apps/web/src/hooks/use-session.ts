import { useCallback, useEffect, useState } from 'react';
import { apiUrl } from '@/lib/api-base';

export type SessionUser = {
  id?: string;
  name: string;
  email?: string;
};

const isDesktop =
  import.meta.env.VITE_VEYLIN_DESKTOP_AUTH === '1' ||
  import.meta.env.VITE_VEYLIN_DESKTOP_AUTH === 'true';

export function useSession() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsAuth, setNeedsAuth] = useState(false);

  const refresh = useCallback(async () => {
    if (isDesktop) {
      setUser({ name: 'Dev User', id: 'dev-user' });
      setNeedsAuth(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      // Probe which identity mode the server is in
      const portsRes = await fetch(apiUrl('/api/enterprise/ports'), { credentials: 'include' });
      if (portsRes.ok) {
        const ports = (await portsRes.json()) as {
          supportsLocalCredentials?: boolean;
          identity?: string;
        };
        if (ports.identity === 'desktop') {
          setUser({ name: 'Dev User', id: 'dev-user' });
          setNeedsAuth(false);
          setLoading(false);
          return;
        }
        if (!ports.supportsLocalCredentials && ports.identity !== 'local') {
          // OIDC/webhook: try session via a protected ping — use get-session only for local.
          // For external IdP, Authorization header may be required; still show app if ports ok
          // and a subsequent API works. Fall through to session check below when possible.
        }
      }

      const res = await fetch(apiUrl('/api/auth/get-session'), { credentials: 'include' });
      if (res.ok) {
        const data = (await res.json()) as {
          user?: { id?: string; name?: string; email?: string };
        } | null;
        if (data?.user?.id || data?.user?.email || data?.user?.name) {
          setUser({
            id: data.user.id,
            name: data.user.name ?? data.user.email ?? 'User',
            email: data.user.email,
          });
          setNeedsAuth(false);
          setLoading(false);
          return;
        }
      }

      // No local session — require auth UI for local provider
      setUser(null);
      setNeedsAuth(true);
    } catch {
      setUser(null);
      setNeedsAuth(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { user, loading, needsAuth, refresh, isDesktop };
}

export async function logout(): Promise<void> {
  try {
    await fetch(apiUrl('/api/auth/sign-out'), { method: 'POST', credentials: 'include' });
  } catch {
    // desktop / no auth
  }
  localStorage.clear();
  window.location.reload();
}
