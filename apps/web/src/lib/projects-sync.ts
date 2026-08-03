/**
 * Client cache of first-class projects (`GET /api/projects` — enabled rows
 * only, wire shape `{id, name, sources, managed}`). This replaces
 * mcp-groups-sync.ts as the sidebar's project source: buckets/pins are keyed
 * by `project.id`, labels come from `project.name`. Cache/refresh + listener
 * idiom mirrors thread-projects-sync.ts so every pin-adjacent surface
 * re-renders after `invalidateProjects()` (e.g. 新建项目 dialog success).
 */
import { useSyncExternalStore } from 'react';

export type ProjectInfo = {
  id: string;
  name: string;
  /** Compass source (scene) codes, e.g. ['guolu'] or ['guolu', 'shangzhong']. */
  sources: string[];
  /** Reconciler-managed default project (one per granted source). */
  managed: boolean;
};

const EMPTY: ProjectInfo[] = [];

let cached: ProjectInfo[] | null = null;
let inflight: Promise<ProjectInfo[]> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export async function fetchProjects(force = false): Promise<ProjectInfo[]> {
  if (!force && cached) return cached;
  if (!force && inflight) return inflight;
  inflight = fetch('/api/projects')
    .then((r) => r.json())
    .then((d: { projects?: ProjectInfo[] }) => {
      cached = d.projects ?? EMPTY;
      notify();
      return cached;
    })
    .catch(() => {
      cached = cached ?? EMPTY;
      notify();
      return cached;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function readCachedProjects(): ProjectInfo[] {
  return cached ?? EMPTY;
}

export function subscribeProjects(listener: () => void): () => void {
  listeners.add(listener);
  if (cached === null) void fetchProjects();
  return () => {
    listeners.delete(listener);
  };
}

/** Force a refetch and notify subscribers — call after any project mutation
 * (新建项目 dialog create, future rename/delete). */
export function invalidateProjects(): void {
  void fetchProjects(true);
}

/** Reactive enabled-projects list; subscribes once per mounted consumer and
 * shares the underlying fetch/cache. */
export function useProjects(): ProjectInfo[] {
  return useSyncExternalStore(subscribeProjects, readCachedProjects, () => EMPTY);
}

/** `POST /api/projects` — compose a user project from granted sources.
 * Success returns the created project; failure surfaces the server's 400
 * message (e.g. ungranted source) for inline display. */
export async function createProject(
  name: string,
  sources: string[],
): Promise<{ ok: true; project: ProjectInfo } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, sources }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      project?: ProjectInfo;
      error?: string;
    };
    if (!res.ok || !data.ok || !data.project) {
      return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    }
    return { ok: true, project: data.project };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
