import { useEffect, useState } from 'react';
import { isTauri } from '@/lib/tauri-web-view';

export type SessionUser = {
  name: string;
  email?: string;
};

export function useSession() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    // Desktop / desktop-auth mode has no /api/auth routes — skip the round-trip.
    if (import.meta.env.VITE_VEYLIN_DESKTOP_AUTH === '1' || isTauri()) {
      setUser({ name: 'Dev User' });
      setLoading(false);
      return;
    }

    fetch('/api/auth/get-session', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { user?: { name?: string; email?: string } } | null) => {
        if (cancelled) return;
        if (data?.user?.name || data?.user?.email) {
          setUser({
            name: data.user.name ?? data.user.email ?? 'User',
            email: data.user.email,
          });
        } else {
          setUser({ name: 'Dev User' });
        }
      })
      .catch(() => {
        if (!cancelled) setUser({ name: 'Dev User' });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { user, loading };
}

export async function logout(): Promise<void> {
  try {
    await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'include' });
  } catch {
    // desktop / no auth
  }
  localStorage.clear();
  window.location.reload();
}
