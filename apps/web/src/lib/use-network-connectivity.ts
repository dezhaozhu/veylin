import { useEffect } from 'react';
import { useNetworkReconnectStore } from '@/lib/network-reconnect-store';

/** Sync browser online/offline events into reconnect banner state. */
export function useNetworkConnectivity() {
  const setOffline = useNetworkReconnectStore((s) => s.setOffline);

  useEffect(() => {
    setOffline(!navigator.onLine);

    const onOffline = () => setOffline(true);
    const onOnline = () => setOffline(false);

    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [setOffline]);
}
