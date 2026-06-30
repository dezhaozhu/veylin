import type { FastifyInstance } from 'fastify';
import { customSkillInputSchema } from '@veylin/shared';
import {
  createCustomSkill,
  deleteCustomSkill,
  getDisabledSkills,
  listMergedSkills,
  setDisabledSkills,
  updateCustomSkill,
} from '../skills-store.js';
import type { ServerDeps } from './types.js';

export function registerSkillsRoutes(app: FastifyInstance, deps: ServerDeps): void {
  // --- Customize: Skills ---
  app.get('/api/skills', async (req) => {
    const ctx = await deps.resolveContext(req.headers);
    const { agentId } = req.query as { agentId?: string };
    const skills = await listMergedSkills(deps.runtime, ctx.tenantId, agentId);
    const disabledSkills = await getDisabledSkills(ctx.tenantId);
    return { skills, disabledSkills };
  });

  app.post('/api/skills/disabled', async (req) => {
    const ctx = await deps.resolveContext(req.headers);
    const { disabledSkills } = (req.body ?? {}) as { disabledSkills?: string[] };
    await setDisabledSkills(ctx.tenantId, disabledSkills ?? []);
    return { ok: true, disabledSkills: disabledSkills ?? [] };
  });

  app.post('/api/skills', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const parsed = customSkillInputSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, message: parsed.error.message };
    }
    const row = await createCustomSkill(ctx.tenantId, parsed.data);
    return { ok: true, skill: row };
  });

  app.put('/api/skills/:id', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const { id } = req.params as { id: string };
    const parsed = customSkillInputSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, message: parsed.error.message };
    }
    const row = await updateCustomSkill(ctx.tenantId, id, parsed.data);
    if (!row) {
      reply.code(404);
      return { ok: false };
    }
    return { ok: true, skill: row };
  });

  app.delete('/api/skills/:id', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const { id } = req.params as { id: string };
    const ok = await deleteCustomSkill(ctx.tenantId, id);
    if (!ok) {
      reply.code(404);
      return { ok: false };
    }
    return { ok: true };
  });


}
