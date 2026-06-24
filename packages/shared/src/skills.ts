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
