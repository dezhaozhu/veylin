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
  /** 项目文件夹绝对路径(用户在桌面端选);未绑 = undefined。见 spec 2026-08-14。 */
  folder?: string;
  /** 项目级指令 —— 会喂给模型(见 chat.ts buildProjectPinBlock)。 */
  instructions?: string;
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

/**
 * 和 useProjects 的区别只在**"还没加载"和"真的一个项目都没有"要分得开** ——
 * 前者返回 EMPTY,两种情况长得一样,依赖它做判断会把该做的事跳过去。
 */
export function useProjectsOrNull(): ProjectInfo[] | null {
  return useSyncExternalStore(
    subscribeProjects,
    () => cached,
    () => null,
  );
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
  /** 项目级指令 —— 会喂给模型(见 chat.ts buildProjectPinBlock)。 */
  instructions = '',
): Promise<{ ok: true; project: ProjectInfo } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, sources, ...(instructions ? { instructions } : {}) }),
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

/**
 * `PATCH /api/projects/:id` —— 绑定项目文件夹(spec 2026-08-14 §2)。
 *
 * managed 项目也能绑:文件夹既不是身份也不是范围,是本机偏好,而默认项目
 * (锅炉厂、上重)恰恰是最需要它的那些。名字与场景仍归 reconciler 管。
 */
/** 改项目说明 —— 它会作为项目级指令喂给模型(见 chat.ts buildProjectPinBlock)。 */
export async function setProjectInstructions(
  id: string,
  instructions: string,
): Promise<{ ok: true; project: ProjectInfo } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instructions }),
    });
    const body = (await res.json()) as { ok?: boolean; project?: ProjectInfo; error?: string };
    if (!res.ok || !body.ok || !body.project) {
      return { ok: false, error: body.error ?? `保存失败(HTTP ${res.status})` };
    }
    invalidateProjects();
    return { ok: true, project: body.project };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 事后改这个项目用哪些数据源 —— 建项目时不必选,那句"以后随时能加"得有地方落。 */
export async function setProjectSources(
  id: string,
  sources: string[],
): Promise<{ ok: true; project: ProjectInfo } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sources }),
    });
    const body = (await res.json()) as { ok?: boolean; project?: ProjectInfo; error?: string };
    if (!res.ok || !body.ok || !body.project) {
      return { ok: false, error: body.error ?? `保存失败(HTTP ${res.status})` };
    }
    invalidateProjects();
    return { ok: true, project: body.project };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function setProjectFolder(
  id: string,
  folder: string,
): Promise<{ ok: true; project: ProjectInfo } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder }),
    });
    const data = (await res.json()) as { ok?: boolean; project?: ProjectInfo; error?: string };
    if (!res.ok || !data.ok || !data.project) {
      return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    }
    invalidateProjects();
    return { ok: true, project: data.project };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
