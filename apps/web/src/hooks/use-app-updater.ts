import { useCallback, useEffect, useState } from 'react';
import { checkAppUpdate, type AppUpdateInfo } from '@/lib/tauri-updater';
import { isTauri } from '@/lib/tauri-web-view';

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

export function useAppUpdater() {
  const [pendingUpdate, setPendingUpdate] = useState<AppUpdateInfo | null>(null);
  const [installing, setInstalling] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const update = await checkAppUpdate();
      setPendingUpdate(update);
      setCheckError(null);
    } catch (err) {
      setPendingUpdate(null);
      setCheckError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), CHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const installUpdate = useCallback(async () => {
    if (!pendingUpdate || installing) return;
    setInstalling(true);
    setInstallError(null);
    try {
      await pendingUpdate.install();
    } catch (err) {
      setInstalling(false);
      setInstallError(err instanceof Error ? err.message : String(err));
    }
  }, [pendingUpdate, installing]);

  const clearErrors = useCallback(() => {
    setCheckError(null);
    setInstallError(null);
  }, []);

  return {
    updateAvailable: pendingUpdate !== null,
    version: pendingUpdate?.version ?? null,
    installing,
    checkError,
    installError,
    installUpdate,
    refresh,
    clearErrors,
  };
}
