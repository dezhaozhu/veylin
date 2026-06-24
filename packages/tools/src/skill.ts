import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export interface SkillEntry {
  name: string;
  description: string;
  content: string;
}

type SkillHook = (entry: { name: string; content: string }) => void | Promise<void>;
type SkillResolver = (name: string) => string | null | Promise<string | null>;

/**
 * Build a `skill` tool bound to a specific agent's skills. Calling this tool
 * loads the full SKILL.md and notifies the host via requestContext.onSkillActivated.
 */
export function makeSkillTool(skills: SkillEntry[]) {
  const byName = new Map(skills.map((s) => [s.name, s]));
  return createTool({
    id: 'skill',
    description:
      'Activate a named skill to load its full step-by-step instructions. ' +
      `Available skills: ${skills.map((s) => s.name).join(', ') || '(none)'}.`,
    inputSchema: z.object({
      name: z.string().describe('Skill name to activate'),
    }),
    outputSchema: z.object({
      name: z.string(),
      content: z.string(),
      found: z.boolean(),
    }),
    execute: async (input, ctx) => {
      const allowed = ctx?.requestContext?.get('enabledSkillNames') as string[] | undefined;
      if (allowed && !allowed.includes(input.name)) {
        return {
          name: input.name,
          found: false,
          content: `Skill "${input.name}" is disabled.`,
        };
      }

      let name = input.name;
      let content = byName.get(input.name)?.content;
      if (!content) {
        const resolver = ctx?.requestContext?.get('resolveSkillByName') as SkillResolver | undefined;
        if (resolver) {
          content = (await resolver(input.name)) ?? undefined;
        }
      }
      if (!content) {
        return {
          name: input.name,
          found: false,
          content: `No skill named "${input.name}". Available: ${allowed?.join(', ') || [...byName.keys()].join(', ')}`,
        };
      }

      const hook = ctx?.requestContext?.get('onSkillActivated') as SkillHook | undefined;
      if (hook) await hook({ name, content });
      return { name, found: true, content };
    },
  });
}
