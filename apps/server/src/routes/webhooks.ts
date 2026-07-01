import type { FastifyInstance } from 'fastify';
import { webhookCreateInputSchema, webhookUpdateInputSchema } from '@veylin/shared';
import {
  createGithubWebhookEndpoint,
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  getWebhookConfig,
  listWebhookEndpoints,
  updateWebhookEndpoint,
  verifyWebhookSignature,
  resolveEventKey,
  buildEventContext,
} from '../webhook-store.js';
import { dispatchAutomation } from '../automation-worker.js';
import {
  listEventAutomations,
  matchesEventTrigger,
} from '../automation-store.js';
import { dispatchWorkflow } from '../workflow-runner.js';
import {
  listEventWorkflows,
} from '../workflow-store.js';
import type { ServerDeps } from './types.js';

export function registerWebhooksRoutes(app: FastifyInstance, deps: ServerDeps): void {
  // --- Automate: Webhooks ---
  app.get('/api/webhooks', async (req) => {
    const ctx = await deps.resolveContext(req.headers);
    const baseUrl = `${req.protocol}://${req.headers.host}`;
    const endpoints = await listWebhookEndpoints(ctx.tenantId, baseUrl);
    return { endpoints };
  });

  app.post('/api/webhooks', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const baseUrl = `${req.protocol}://${req.headers.host}`;
    const body = (req.body ?? {}) as Record<string, unknown>;

    if (body.preset === 'github') {
      const { endpoint, secret } = await createGithubWebhookEndpoint(
        ctx.tenantId,
        baseUrl,
        typeof body.name === 'string' ? body.name : 'GitHub',
      );
      return { ok: true, endpoint, secret };
    }

    const parsed = webhookCreateInputSchema.safeParse(body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, message: parsed.error.message };
    }

    try {
      const { endpoint, secret } = await createWebhookEndpoint(ctx.tenantId, parsed.data, baseUrl);
      return { ok: true, endpoint, secret };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('unique') || message.includes('UNIQUE')) {
        reply.code(409);
        return { ok: false, message: `Webhook source '${parsed.data.source}' already exists` };
      }
      throw err;
    }
  });

  app.delete('/api/webhooks/:id', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const { id } = req.params as { id: string };
    const ok = await deleteWebhookEndpoint(ctx.tenantId, id);
    if (!ok) {
      reply.code(404);
      return { ok: false };
    }
    return { ok: true };
  });

  app.put('/api/webhooks/:id', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const baseUrl = `${req.protocol}://${req.headers.host}`;
    const { id } = req.params as { id: string };
    const parsed = webhookUpdateInputSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, message: parsed.error.message };
    }
    const endpoint = await updateWebhookEndpoint(ctx.tenantId, id, parsed.data, baseUrl);
    if (!endpoint) {
      reply.code(404);
      return { ok: false };
    }
    return { ok: true, endpoint };
  });

  app.post('/api/events/:tenantId/:source', async (req, reply) => {
    const { tenantId, source } = req.params as { tenantId: string; source: string };
    const config = await getWebhookConfig(tenantId, source.toLowerCase());
    if (!config) {
      reply.code(404);
      return { ok: false, message: `Unknown webhook source: ${source}` };
    }

    const rawBody =
      (req as typeof req & { rawBody?: Buffer }).rawBody ??
      Buffer.from(JSON.stringify(req.body ?? {}), 'utf8');
    const signature = req.headers[config.signatureHeader.toLowerCase()] as string | undefined;

    if (!verifyWebhookSignature(rawBody, signature, config.secret)) {
      reply.code(401);
      return { ok: false, message: 'invalid signature' };
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
    } catch {
      payload = { raw: rawBody.toString('utf8') };
    }

    const githubEventType = req.headers['x-github-event'] as string | undefined;
    const eventKey = resolveEventKey(config.source, payload, config.eventKeyExpr, githubEventType);
    const eventContext = buildEventContext(config.source, eventKey, payload, githubEventType);

    const automations = await listEventAutomations(tenantId, config.source);
    const matched = automations.filter((a) =>
      matchesEventTrigger(
        {
          source: a.sourceType,
          on: a.eventOn,
          filter: a.eventFilter,
        },
        config.source,
        eventKey,
        payload,
      ),
    );

    for (const automation of matched) {
      await dispatchAutomation(deps.queue, {
        tenantId,
        automationId: automation.id,
        eventContext,
      });
    }

    const workflows = await listEventWorkflows(tenantId, config.source);
    const matchedWorkflows = workflows.filter((w) =>
      matchesEventTrigger(
        {
          source: w.sourceType,
          on: w.eventOn,
          filter: w.eventFilter,
        },
        config.source,
        eventKey,
        payload,
      ),
    );

    for (const workflow of matchedWorkflows) {
      await dispatchWorkflow(deps.queue, {
        tenantId,
        workflowId: workflow.id,
        eventContext,
      });
    }

    return { ok: true, received: true, matched: matched.length + matchedWorkflows.length };
  });


}
