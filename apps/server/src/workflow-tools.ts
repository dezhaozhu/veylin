import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { workflowDefinitionSchema } from '@veylin/shared';
import type { QueuePort } from './queue';
import { listWorkflows, getWorkflow } from './workflow-store';
import { dispatchWorkflow } from './workflow-runner';
import { generateWorkflowFromPrompt } from './workflow-generate';

interface WorkflowCtx {
  requestContext?: { get(key: string): unknown };
}

function ctxValue(ctx: WorkflowCtx | undefined, key: string): string | undefined {
  return ctx?.requestContext?.get(key) as string | undefined;
}

export function buildWorkflowTools(queue: QueuePort) {
  const workflowList = createTool({
    id: 'workflow_list',
    description: 'List visual workflow DAGs for the current user.',
    inputSchema: z.object({}),
    outputSchema: z.object({
      workflows: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          kind: z.string(),
          enabled: z.boolean(),
          cron: z.string().nullable().optional(),
        }),
      ),
    }),
    execute: async (_input, ctx?: WorkflowCtx) => {
      const tenantId = ctxValue(ctx, 'tenantId') ?? '00000000-0000-0000-0000-000000000000';
      const userId = ctxValue(ctx, 'userId') ?? 'dev-user';
      const rows = await listWorkflows(tenantId, userId);
      return {
        workflows: rows.map((w) => ({
          id: w.id,
          name: w.name,
          kind: w.kind,
          enabled: w.enabled,
          cron: w.cron,
        })),
      };
    },
  });

  const workflowRun = createTool({
    id: 'workflow_run',
    description: 'Manually trigger a workflow DAG run.',
    inputSchema: z.object({ id: z.string() }),
    outputSchema: z.object({ ok: z.boolean(), jobId: z.string().nullable() }),
    execute: async (input, ctx?: WorkflowCtx) => {
      const tenantId = ctxValue(ctx, 'tenantId') ?? '00000000-0000-0000-0000-000000000000';
      const row = await getWorkflow(tenantId, input.id);
      if (!row) return { ok: false, jobId: null };
      const jobId = await dispatchWorkflow(queue, {
        tenantId,
        workflowId: row.id,
        eventContext: { manual: true },
      });
      return { ok: true, jobId: jobId ?? null };
    },
  });

  const workflowGenerate = createTool({
    id: 'workflow_generate',
    description:
      'Generate or revise a visual workflow DAG from natural language. Returns name + nodes/edges for the workflow editor.',
    inputSchema: z.object({
      prompt: z.string().describe('What the workflow should do'),
      currentDefinition: workflowDefinitionSchema.optional().describe('Existing DAG to extend or modify'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      name: z.string().optional(),
      definition: workflowDefinitionSchema.optional(),
      message: z.string().optional(),
    }),
    execute: async (input, ctx?: WorkflowCtx) => {
      const tenantId = ctxValue(ctx, 'tenantId');
      if (!tenantId) {
        return { ok: false, message: 'tenantId required' };
      }
      try {
        const current = input.currentDefinition
          ? workflowDefinitionSchema.parse(input.currentDefinition)
          : undefined;
        const generated = await generateWorkflowFromPrompt(tenantId, input.prompt, current);
        return { ok: true, ...generated };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
      }
    },
  });

  return {
    workflow_list: workflowList,
    workflow_run: workflowRun,
    workflow_generate: workflowGenerate,
  };
}
