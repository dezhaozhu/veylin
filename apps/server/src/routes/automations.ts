import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { automationInputSchema } from '@veylin/shared';
import {
  registerAutomationSchedule,
  unregisterAutomationSchedule,
} from '../queue.js';
import { dispatchAutomation } from '../automation-worker.js';
import {
  createAutomation,
  deleteAutomation,
  getAutomation,
  listAutomationRuns,
  listAutomations,
  updateAutomation,
} from '../automation-store.js';
import type { ServerDeps } from './types.js';

export function registerAutomationsRoutes(app: FastifyInstance, deps: ServerDeps): void {
  // --- Automate: Automations ---
  app.get('/api/automations', async (req) => {
    const ctx = await deps.resolveContext(req.headers);
    const automations = await listAutomations(ctx.tenantId, ctx.userId);
    return { automations };
  });

  app.get('/api/automations/:id', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const { id } = req.params as { id: string };
    const automation = await getAutomation(ctx.tenantId, id);
    if (!automation) {
      reply.code(404);
      return { ok: false };
    }
    return { automation };
  });

  app.post('/api/automations', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const parsed = automationInputSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, message: parsed.error.message };
    }
    const automation = await createAutomation(ctx.tenantId, ctx.userId, parsed.data);
    if (automation.enabled && automation.kind === 'cron' && automation.cron) {
      await registerAutomationSchedule(deps.queue, automation.id, automation.cron, automation.timezone ?? 'UTC', {
        tenantId: ctx.tenantId,
        automationId: automation.id,
        eventContext: {},
      });
    }
    return { ok: true, automation };
  });

  app.put('/api/automations/:id', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const { id } = req.params as { id: string };
    const parsed = automationInputSchema.partial().extend({ enabled: z.boolean().optional() }).safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, message: parsed.error.message };
    }
    const automation = await updateAutomation(ctx.tenantId, id, parsed.data);
    if (!automation) {
      reply.code(404);
      return { ok: false };
    }
    if (automation.kind === 'cron' && automation.cron) {
      if (automation.enabled) {
        await registerAutomationSchedule(deps.queue, automation.id, automation.cron, automation.timezone ?? 'UTC', {
          tenantId: ctx.tenantId,
          automationId: automation.id,
          eventContext: {},
        });
      } else {
        await unregisterAutomationSchedule(deps.queue, automation.id);
      }
    }
    return { ok: true, automation };
  });

  app.delete('/api/automations/:id', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const { id } = req.params as { id: string };
    const existing = await getAutomation(ctx.tenantId, id);
    if (!existing) {
      reply.code(404);
      return { ok: false };
    }
    const ok = await deleteAutomation(ctx.tenantId, id);
    if (existing.kind === 'cron') {
      await unregisterAutomationSchedule(deps.queue, id);
    }
    return { ok };
  });

  app.post('/api/automations/:id/trigger', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const { id } = req.params as { id: string };
    const automation = await getAutomation(ctx.tenantId, id);
    if (!automation) {
      reply.code(404);
      return { ok: false };
    }
    const jobId = await dispatchAutomation(deps.queue, {
      tenantId: ctx.tenantId,
      automationId: automation.id,
      eventContext: { manual: true },
    });
    return { ok: true, jobId };
  });

  app.get('/api/automations/:id/runs', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const { id } = req.params as { id: string };
    const automation = await getAutomation(ctx.tenantId, id);
    if (!automation) {
      reply.code(404);
      return { ok: false };
    }
    const runs = await listAutomationRuns(ctx.tenantId, id);
    return { runs };
  });


}
