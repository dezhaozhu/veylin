import type { FastifyInstance } from 'fastify';
import { customSkillInputSchema } from '@veylin/shared';
import { refreshAgentPackages } from '../agent-packages-sync.js';
import {
  createUserSkill,
  deleteUserSkill,
  getDisabledSkills,
  getVeylinSkillsDir,
  importUserSkillFromDir,
  listMergedSkills,
  setDisabledSkills,
  updateUserSkill,
} from '../skills-store.js';
import type { ServerDeps } from './types.js';

export function registerSkillsRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/api/skills', async (req) => {
    const ctx = await deps.resolveContext(req.headers);
    const { agentId } = req.query as { agentId?: string };
    await refreshAgentPackages(deps.runtime, { force: true });
    const skills = await listMergedSkills(deps.runtime, ctx.tenantId, agentId);
    const disabledSkills = await getDisabledSkills(ctx.tenantId);
    return { skills, disabledSkills, skillsDir: getVeylinSkillsDir() };
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
    try {
      const skill = await createUserSkill(parsed.data);
      if (parsed.data.enabled === false) {
        const disabled = await getDisabledSkills(ctx.tenantId);
        if (!disabled.includes(skill.name)) {
          await setDisabledSkills(ctx.tenantId, [...disabled, skill.name]);
        }
      }
      return { ok: true, skill };
    } catch (err) {
      reply.code(400);
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  });

  app.post('/api/skills/import', async (req, reply) => {
    await deps.resolveContext(req.headers);
    const body = (req.body ?? {}) as { path?: string };
    if (!body.path?.trim()) {
      reply.code(400);
      return { ok: false, message: 'path required' };
    }
    try {
      const skill = await importUserSkillFromDir(body.path.trim());
      return { ok: true, skill };
    } catch (err) {
      reply.code(400);
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  });

  app.put('/api/skills/:id', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const { id } = req.params as { id: string };
    const parsed = customSkillInputSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, message: parsed.error.message };
    }
    try {
      const skill = await updateUserSkill(decodeURIComponent(id), parsed.data);
      if (!skill) {
        reply.code(404);
        return { ok: false };
      }
      if (parsed.data.enabled === false) {
        const disabled = await getDisabledSkills(ctx.tenantId);
        if (!disabled.includes(skill.name)) {
          await setDisabledSkills(ctx.tenantId, [...disabled, skill.name]);
        }
      } else if (parsed.data.enabled === true) {
        const disabled = await getDisabledSkills(ctx.tenantId);
        await setDisabledSkills(
          ctx.tenantId,
          disabled.filter((n) => n !== skill.name),
        );
      }
      return { ok: true, skill };
    } catch (err) {
      reply.code(400);
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  });

  app.delete('/api/skills/:id', async (req, reply) => {
    await deps.resolveContext(req.headers);
    const { id } = req.params as { id: string };
    const ok = await deleteUserSkill(decodeURIComponent(id));
    if (!ok) {
      reply.code(404);
      return { ok: false };
    }
    return { ok: true };
  });
}
