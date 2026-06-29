import { z } from 'zod';

export const skillSourceSchema = z.enum(['bundled', 'custom']);
export type SkillSource = z.infer<typeof skillSourceSchema>;

export const skillListItemSchema = z.object({
  name: z.string(),
  description: z.string(),
  source: skillSourceSchema,
  type: z.string().default('knowledge'),
  triggers: z.array(z.string()).default([]),
  enabled: z.boolean(),
  /** When true, omit from auto-trigger catalog; user may still invoke via /skill. */
  disableModelInvocation: z.boolean().default(false),
  /** When false, hide from composer slash menu. */
  userInvocable: z.boolean().default(true),
  content: z.string().optional(),
  id: z.string().optional(),
});

export type SkillListItem = z.infer<typeof skillListItemSchema>;

export const customSkillInputSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  content: z.string().min(1),
  enabled: z.boolean().default(true),
});

export type CustomSkillInput = z.infer<typeof customSkillInputSchema>;

/** Per-request skill index for the model (auto-invocable vs manual-only). */
export function buildSkillsCatalogBlock(skills: SkillListItem[]): string {
  const enabled = skills.filter((s) => s.enabled);
  const auto = enabled.filter((s) => !s.disableModelInvocation);
  const manualOnly = enabled.filter((s) => s.disableModelInvocation);
  if (auto.length === 0 && manualOnly.length === 0) return '';

  const lines: string[] = [];
  if (auto.length > 0) {
    lines.push(
      '## Available Skills',
      ...auto.map((s) => `- ${s.name}: ${s.description}`),
      'When a skill is relevant, load its full instructions with the `skill` tool before acting.',
    );
  }
  if (manualOnly.length > 0) {
    lines.push(
      '## Manual-only Skills',
      ...manualOnly.map((s) => `- ${s.name}: ${s.description}`),
      'Do not load these with the `skill` tool unless the user explicitly invoked them via /skill-name.',
    );
  }
  return lines.join('\n');
}
