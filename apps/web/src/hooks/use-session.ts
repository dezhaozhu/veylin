import { useCallback, useEffect, useState } from 'react';
import { apiUrl } from '@/lib/api-base';

export type SessionUser = {
  id?: string;
  name: string;
  email?: string;
  /** Platform numeric id as string when logged in. */
  platformUserId?: string;
};

export type DesktopAuthSession = {
  enabled: boolean;
  configured: boolean;
  installId: string;
  loggedIn: boolean;
  user: {
    id: number;
    username: string;
    display_name: string;
    email: string;
  } | null;
};

const isDesktop =
  import.meta.env.VITE_VEYLIN_DESKTOP_AUTH === '1' ||
  import.meta.env.VITE_VEYLIN_DESKTOP_AUTH === 'true';

function mapDesktopSession(data: DesktopAuthSession): SessionUser | null {
  if (data.loggedIn && data.user) {
    return {
      id: data.installId,
      platformUserId: String(data.user.id),
      name: data.user.display_name || data.user.username,
      email: data.user.email || undefined,
    };
  }
  return {
    id: data.installId,
    name: '未登录',
  };
}

export function useSession() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [platformConfigured, setPlatformConfigured] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);

  const refresh = useCallback(async () => {
    if (isDesktop) {
      setLoading(true);
      try {
        const res = await fetch(apiUrl('/api/desktop-auth/session'), {
          credentials: 'include',
        });
        if (res.ok) {
          const data = (await res.json()) as DesktopAuthSession;
          setPlatformConfigured(Boolean(data.configured));
          setLoggedIn(Boolean(data.loggedIn));
          setUser(mapDesktopSession(data));
          setNeedsAuth(false);
          return;
        }
        // Fallback: status only
        const st = await fetch(apiUrl('/api/desktop-auth/status'), {
          credentials: 'include',
        });
        if (st.ok) {
          const status = (await st.json()) as {
            configured?: boolean;
            installId?: string;
          };
          setPlatformConfigured(Boolean(status.configured));
          setLoggedIn(false);
          setUser({
            id: status.installId,
            name: '未登录',
          });
          setNeedsAuth(false);
          return;
        }
        setUser({ name: '未登录' });
        setNeedsAuth(false);
        setLoggedIn(false);
      } catch {
        setUser({ name: '未登录' });
        setNeedsAuth(false);
        setLoggedIn(false);
      } finally {
        setLoading(false);
      }
      return;
    }

    setLoading(true);
    try {
      const portsRes = await fetch(apiUrl('/api/enterprise/ports'), {
        credentials: 'include',
      });
      if (portsRes.ok) {
        const ports = (await portsRes.json()) as {
          supportsLocalCredentials?: boolean;
          identity?: string;
        };
        if (ports.identity === 'desktop') {
          const res = await fetch(apiUrl('/api/desktop-auth/session'), {
            credentials: 'include',
          });
          if (res.ok) {
            const data = (await res.json()) as DesktopAuthSession;
            setPlatformConfigured(Boolean(data.configured));
            setLoggedIn(Boolean(data.loggedIn));
            setUser(mapDesktopSession(data));
            setNeedsAuth(false);
            setLoading(false);
            return;
          }
          setUser({ name: '未登录' });
          setNeedsAuth(false);
          setLoading(false);
          return;
        }
      }

      const res = await fetch(apiUrl('/api/auth/get-session'), {
        credentials: 'include',
      });
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
          setLoggedIn(true);
          setLoading(false);
          return;
        }
      }

      setUser(null);
      setNeedsAuth(true);
      setLoggedIn(false);
    } catch {
      setUser(null);
      setNeedsAuth(true);
      setLoggedIn(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    user,
    loading,
    needsAuth,
    refresh,
    isDesktop,
    platformConfigured,
    loggedIn,
  };
}

export async function loginDesktop(
  username: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(apiUrl('/api/desktop-auth/login'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      loggedIn?: boolean;
    };
    if (!res.ok) {
      return { ok: false, error: body.error || '登录失败' };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: '无法连接服务器' };
  }
}

export async function logout(): Promise<void> {
  if (isDesktop) {
    try {
      await fetch(apiUrl('/api/desktop-auth/logout'), {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // ignore
    }
    window.location.reload();
    return;
  }
  try {
    await fetch(apiUrl('/api/auth/sign-out'), {
      method: 'POST',
      credentials: 'include',
    });
  } catch {
    // desktop / no auth
  }
  localStorage.clear();
  window.location.reload();
}
