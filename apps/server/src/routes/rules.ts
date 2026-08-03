import type { FastifyInstance } from 'fastify';
import { ruleInputSchema } from '@veylin/shared';
import {
  createRule,
  deleteRule,
  listRules,
  updateRule,
} from '../rules-store.js';
import type { ServerDeps } from './types.js';

export function registerRulesRoutes(app: FastifyInstance, deps: ServerDeps): void {
  // --- Customize: Rules ---
  app.get('/api/rules', async (req) => {
    const ctx = await deps.resolveContext(req.headers);
    const { agentId } = req.query as { agentId?: string };
    const rules = await listRules(ctx.tenantId, ctx.userId, agentId);
    return { rules };
  });

  app.post('/api/rules', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const parsed = ruleInputSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, message: parsed.error.message };
    }
    const rule = await createRule(ctx.tenantId, parsed.data);
    return { ok: true, rule };
  });

  app.put('/api/rules/:id', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const { id } = req.params as { id: string };
    const parsed = ruleInputSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, message: parsed.error.message };
    }
    const rule = await updateRule(ctx.tenantId, id, parsed.data);
    if (!rule) {
      reply.code(404);
      return { ok: false };
    }
    return { ok: true, rule };
  });

  app.delete('/api/rules/:id', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const { id } = req.params as { id: string };
    const ok = await deleteRule(ctx.tenantId, id);
    if (!ok) {
      reply.code(404);
      return { ok: false };
    }
    return { ok: true };
  });


}
