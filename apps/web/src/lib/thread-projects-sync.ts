/**
 * Client cache of the tenant's thread→project map (Projects sidebar
 * grouping): `GET /api/projects/threads` returns `{ [threadId]: project }`
 * for every pinned thread. Cache/refresh idiom mirrors project-sync.ts /
 * mcp-groups-sync.ts (force-refetch cache); adds a listener set so the
 * sidebar re-renders after any pin change elsewhere (new-chat pin, move
 * menu, composer project-chip picker) via `invalidateThreadProjects()`.
 */
import { useSyncExternalStore } from 'react';

export type ThreadProjectMap = Record<string, string>;

const EMPTY: ThreadProjectMap = {};

let cached: ThreadProjectMap | null = null;
let inflight: Promise<ThreadProjectMap> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export async function fetchThreadProjects(force = false): Promise<ThreadProjectMap> {
  if (!force && cached) return cached;
  if (!force && inflight) return inflight;
  inflight = fetch('/api/projects/threads')
    .then((r) => r.json())
    .then((d: ThreadProjectMap) => {
      cached = d ?? EMPTY;
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

export function readCachedThreadProjects(): ThreadProjectMap {
  return cached ?? EMPTY;
}

export function subscribeThreadProjects(listener: () => void): () => void {
  listeners.add(listener);
  if (cached === null) void fetchThreadProjects();
  return () => {
    listeners.delete(listener);
  };
}

/** Force a refetch and notify subscribers — call after any successful pin
 * change (new chat pin, move-to-project, project-chip picker select). */
export function invalidateThreadProjects(): void {
  void fetchThreadProjects(true);
}

/** Reactive thread→project map for the sidebar; subscribes once per mounted
 * consumer and shares the underlying fetch/cache. */
export function useThreadProjects(): ThreadProjectMap {
  return useSyncExternalStore(subscribeThreadProjects, readCachedThreadProjects, () => EMPTY);
}
