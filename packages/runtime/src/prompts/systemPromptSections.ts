type SectionCompute = () => string | null | Promise<string | null>;

export type SystemPromptSection = {
  name: string;
  compute: SectionCompute;
  cacheBreak: boolean;
};

const sectionCache = new Map<string, string | null>();

export function systemPromptSection(name: string, compute: SectionCompute): SystemPromptSection {
  return { name, compute, cacheBreak: false };
}

/** Recomputes every turn — use for MCP lists, browser snapshots, per-request data. */
export function uncachedSystemPromptSection(name: string, compute: SectionCompute): SystemPromptSection {
  return { name, compute, cacheBreak: true };
}

export async function resolveSystemPromptSections(
  sections: SystemPromptSection[],
): Promise<(string | null)[]> {
  return Promise.all(
    sections.map(async (section) => {
      if (!section.cacheBreak && sectionCache.has(section.name)) {
        return sectionCache.get(section.name) ?? null;
      }
      const value = await section.compute();
      if (!section.cacheBreak) {
        sectionCache.set(section.name, value);
      }
      return value;
    }),
  );
}

export function clearSystemPromptSections(): void {
  sectionCache.clear();
}
