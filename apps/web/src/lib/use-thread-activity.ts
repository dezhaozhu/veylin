import { useEffect, useState } from 'react';

export type ThreadActivityKind = 'running' | 'finished' | 'interrupted';

export type ThreadActivity = {
  kind: ThreadActivityKind;
  at: string;
};

type ActivityResponse = { activity: Record<string, ThreadActivity> };

export function useThreadActivityMap(): Record<string, ThreadActivity> {
  const [activity, setActivity] = useState<Record<string, ThreadActivity>>({});

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch('/api/threads/activity', { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : { activity: {} }))
        .then((d: ActivityResponse) => {
          if (!cancelled) setActivity(d.activity ?? {});
        })
        .catch(() => undefined);
    };
    load();
    const t = window.setInterval(load, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  return activity;
}
