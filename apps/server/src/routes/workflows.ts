import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { workflowInputSchema } from '@veylin/shared';
import {
  registerWorkflowSchedule,
  unregisterWorkflowSchedule,
} from '../queue.js';
import { dispatchWorkflow } from '../workflow-runner.js';
import {
  createWorkflow,
  deleteWorkflow,
  getWorkflow,
  listWorkflowRuns,
  listWorkflows,
  updateWorkflow,
  WorkflowNameConflictError,
} from '../workflow-store.js';
import { applyTenantModelSettings } from '../model-settings-store.js';
import { generateWorkflowFromPrompt } from '../workflow-generate.js';
import type { ServerDeps } from './types.js';

function requireThreadId(
  source: { threadId?: string } | undefined,
  reply: { code: (n: number) => unknown },
): string | null {
  const threadId = source?.threadId?.trim();
  if (!threadId) {
    reply.code(400);
    return null;
  }
  return threadId;
}

async function getThreadScopedWorkflow(
  tenantId: string,
  id: string,
  threadId: string,
): Promise<Awaited<ReturnType<typeof getWorkflow>>> {
  const workflow = await getWorkflow(tenantId, id);
  if (!workflow || workflow.threadId !== threadId) return null;
  return workflow;
}

export function registerWorkflowsRoutes(app: FastifyInstance, deps: ServerDeps): void {
  // --- Workflow: DAG orchestration ---
  app.get('/api/workflows', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const threadId = requireThreadId(req.query as { threadId?: string }, reply);
    if (!threadId) return { ok: false, message: 'threadId is required' };
    const workflows = await listWorkflows(ctx.tenantId, { userId: ctx.userId, threadId });
    return { workflows };
  });

  app.get('/api/workflows/:id', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const { id } = req.params as { id: string };
    const threadId = requireThreadId(req.query as { threadId?: string }, reply);
    if (!threadId) return { ok: false, message: 'threadId is required' };
    const workflow = await getThreadScopedWorkflow(ctx.tenantId, id, threadId);
    if (!workflow) {
      reply.code(404);
      return { ok: false };
    }
    return { workflow };
  });

  app.post('/api/workflows', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const parsed = workflowInputSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, message: parsed.error.message };
    }
    try {
      const workflow = await createWorkflow(ctx.tenantId, ctx.userId, parsed.data);
      if (workflow.enabled && workflow.kind === 'cron' && workflow.cron) {
        await registerWorkflowSchedule(deps.queue, workflow.id, workflow.cron, workflow.timezone ?? 'UTC', {
          tenantId: ctx.tenantId,
          workflowId: workflow.id,
          eventContext: {},
        });
      }
      return { ok: true, workflow };
    } catch (err) {
      if (err instanceof WorkflowNameConflictError) {
        reply.code(409);
        return { ok: false, message: err.message };
      }
      throw err;
    }
  });

  app.put('/api/workflows/:id', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const { id } = req.params as { id: string };
    const threadId = requireThreadId(
      {
        threadId:
          (req.query as { threadId?: string }).threadId ??
          (req.body as { threadId?: string } | undefined)?.threadId,
      },
      reply,
    );
    if (!threadId) return { ok: false, message: 'threadId is required' };
    const existing = await getThreadScopedWorkflow(ctx.tenantId, id, threadId);
    if (!existing) {
      reply.code(404);
      return { ok: false };
    }
    const parsed = workflowInputSchema.partial().extend({ enabled: z.boolean().optional() }).safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, message: parsed.error.message };
    }
    try {
      const workflow = await updateWorkflow(ctx.tenantId, id, { ...parsed.data, threadId });
      if (!workflow) {
        reply.code(404);
        return { ok: false };
      }
      if (workflow.kind === 'cron' && workflow.cron) {
        if (workflow.enabled) {
          await registerWorkflowSchedule(deps.queue, workflow.id, workflow.cron, workflow.timezone ?? 'UTC', {
            tenantId: ctx.tenantId,
            workflowId: workflow.id,
            eventContext: {},
          });
        } else {
          await unregisterWorkflowSchedule(deps.queue, workflow.id);
        }
      }
      return { ok: true, workflow };
    } catch (err) {
      if (err instanceof WorkflowNameConflictError) {
        reply.code(409);
        return { ok: false, message: err.message };
      }
      throw err;
    }
  });

  app.delete('/api/workflows/:id', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const { id } = req.params as { id: string };
    const threadId = requireThreadId(req.query as { threadId?: string }, reply);
    if (!threadId) return { ok: false, message: 'threadId is required' };
    const existing = await getThreadScopedWorkflow(ctx.tenantId, id, threadId);
    if (!existing) {
      reply.code(404);
      return { ok: false };
    }
    const ok = await deleteWorkflow(ctx.tenantId, id);
    if (existing.kind === 'cron') {
      await unregisterWorkflowSchedule(deps.queue, id);
    }
    return { ok };
  });

  app.post('/api/workflows/:id/run', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const { id } = req.params as { id: string };
    const threadId = requireThreadId(
      {
        threadId:
          (req.query as { threadId?: string }).threadId ??
          (req.body as { threadId?: string } | undefined)?.threadId,
      },
      reply,
    );
    if (!threadId) return { ok: false, message: 'threadId is required' };
    const workflow = await getThreadScopedWorkflow(ctx.tenantId, id, threadId);
    if (!workflow) {
      reply.code(404);
      return { ok: false };
    }
    const jobId = await dispatchWorkflow(deps.queue, {
      tenantId: ctx.tenantId,
      workflowId: workflow.id,
      eventContext: { manual: true },
    });
    return { ok: true, jobId };
  });

  app.get('/api/workflows/:id/runs', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const { id } = req.params as { id: string };
    const threadId = requireThreadId(req.query as { threadId?: string }, reply);
    if (!threadId) return { ok: false, message: 'threadId is required' };
    const workflow = await getThreadScopedWorkflow(ctx.tenantId, id, threadId);
    if (!workflow) {
      reply.code(404);
      return { ok: false };
    }
    const runs = await listWorkflowRuns(ctx.tenantId, id);
    return { runs };
  });

  app.post('/api/workflows/generate', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    await applyTenantModelSettings(ctx.tenantId);
    const body = (req.body ?? {}) as { prompt?: string; currentDefinition?: unknown };
    const prompt = body.prompt?.trim();
    if (!prompt) {
      reply.code(400);
      return { ok: false, message: 'prompt is required' };
    }
    try {
      const parsed = body.currentDefinition
        ? workflowInputSchema.shape.definition.safeParse(body.currentDefinition)
        : null;
      const generated = await generateWorkflowFromPrompt(
        ctx.tenantId,
        prompt,
        parsed?.success ? parsed.data : undefined,
      );
      return { ok: true, ...generated };
    } catch (err) {
      reply.code(500);
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  });
}
