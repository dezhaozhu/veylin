/** Activated skills restored from GET /api/threads/:id/state (read-only UI). */

type Snapshot = {
  threadId: string | undefined;
  skillNames: string[];
};

let snapshot: Snapshot = { threadId: undefined, skillNames: [] };
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function getActivatedSkillsSnapshot(): Snapshot {
  return snapshot;
}

export function subscribeActivatedSkills(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setActivatedSkillsSnapshot(
  threadId: string | undefined,
  skillNames: string[],
): void {
  snapshot = { threadId, skillNames: [...skillNames].sort() };
  emit();
}

export function clearActivatedSkillsSnapshot(): void {
  snapshot = { threadId: undefined, skillNames: [] };
  emit();
}

export async function fetchActivatedSkills(threadId: string): Promise<string[]> {
  const res = await fetch(`/api/threads/${encodeURIComponent(threadId)}/state`, {
    credentials: 'include',
  });
  if (!res.ok) {
    setActivatedSkillsSnapshot(threadId, []);
    return [];
  }
  const data = (await res.json()) as {
    state?: { activatedSkills?: Record<string, string> };
  };
  const names = Object.keys(data.state?.activatedSkills ?? {});
  setActivatedSkillsSnapshot(threadId, names);
  return names;
}
