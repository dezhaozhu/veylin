/** Client project-pin (grouped MCP server scope) cache + API sync — mirrors plan-mode-sync.ts. */

export async function fetchThreadProject(threadId: string): Promise<string | null> {
  const res = await fetch(`/api/project?threadId=${encodeURIComponent(threadId)}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { project?: string | null };
  return data.project ?? null;
}

export async function postThreadProject(threadId: string, project: string): Promise<string | null> {
  const res = await fetch('/api/project', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ threadId, project }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { ok?: boolean; project?: string | null };
  return data.project ?? null;
}

const projectByThread = new Map<string, string | null>();

/** `undefined` = never fetched for this thread; `null` = fetched, confirmed unpinned. */
export function readCachedThreadProject(threadId: string | undefined): string | null | undefined {
  if (!threadId) return undefined;
  return projectByThread.get(threadId);
}

export function writeCachedThreadProject(threadId: string, project: string | null): void {
  projectByThread.set(threadId, project);
}
