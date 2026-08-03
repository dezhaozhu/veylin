/** User-pinned skills restored from GET /api/threads/:id/state (composer chips only). */

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

/** Short label for composer chip (plugin-qualified names → last segment). */
export function skillChipDisplayName(name: string): string {
  const colon = name.lastIndexOf(':');
  if (colon >= 0 && colon < name.length - 1) return name.slice(colon + 1);
  return name;
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
    state?: { pinnedSkills?: string[]; activatedSkills?: Record<string, string> };
  };
  // Composer only shows user-pinned skills (slash), not Skill-tool activations.
  const names = data.state?.pinnedSkills ?? [];
  setActivatedSkillsSnapshot(threadId, names);
  return names;
}
