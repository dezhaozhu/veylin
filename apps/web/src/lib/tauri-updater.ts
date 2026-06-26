import { isTauri } from '@/lib/tauri-web-view';

export interface AppUpdateInfo {
  version: string;
  install: () => Promise<void>;
}

/** Check for a desktop app update. Returns null when none is available or not in Tauri. */
export async function checkAppUpdate(): Promise<AppUpdateInfo | null> {
  if (!isTauri()) return null;

  const { check } = await import('@tauri-apps/plugin-updater');
  const update = await check();
  if (!update) return null;

  return {
    version: update.version,
    install: async () => {
      await update.downloadAndInstall();
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    },
  };
}
