import { isTauri } from '@/lib/tauri-web-view';

export type SidecarStatus = {
  spawnOk: boolean;
  error?: string | null;
};

export async function fetchSidecarStatus(): Promise<SidecarStatus | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const status = await invoke<{ spawn_ok: boolean; error?: string | null }>('get_sidecar_status');
    return { spawnOk: status.spawn_ok, error: status.error ?? null };
  } catch {
    return null;
  }
}
