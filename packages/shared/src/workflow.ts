import { z } from 'zod';

/**
 * Workflow node kinds (v2), modeled after n8n / Dify common node taxonomy:
 *   Trigger  → start
 *   Logic    → if_else
 *   Transform→ set / template / code
 *   Integrate→ http_request
 *   AI       → run_agent / knowledge_retrieval
 *   Data     → table_read / table_write
 *   Output   → end
 */
export const workflowNodeKindSchema = z.enum([
  'start',
  'if_else',
  'set',
  'template',
  'code',
  'http_request',
  'knowledge_retrieval',
  'run_agent',
  'table_read',
  'table_write',
  'end',
]);

export type WorkflowNodeKind = z.infer<typeof workflowNodeKindSchema>;

/** Comparison operators for if_else conditions (Dify-aligned). */
export const comparisonOperatorSchema = z.enum([
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'is',
  'is_not',
  'is_empty',
  'is_not_empty',
  'in',
  'not_in',
  'eq',
  'neq',
  'gt',
  'lt',
  'gte',
  'lte',
  'is_null',
  'is_not_null',
]);

export type ComparisonOperator = z.infer<typeof comparisonOperatorSchema>;

/** A single condition: left expression compared to right value. */
export const workflowConditionSchema = z.object({
  /** Expression resolving to the left-hand value, e.g. "{{ node1.status }}". */
  left: z.string().default(''),
  operator: comparisonOperatorSchema.default('is'),
  /** Right-hand comparison value (string; coerced per operator). Empty for unary ops. */
  right: z.string().default(''),
});

export type WorkflowCondition = z.infer<typeof workflowConditionSchema>;

/** An if_else case: conditions joined by and/or; matched case routes to its branch. */
export const workflowCaseSchema = z.object({
  caseId: z.string(),
  logicalOperator: z.enum(['and', 'or']).default('and'),
  conditions: z.array(workflowConditionSchema).default([]),
});

export type WorkflowCase = z.infer<typeof workflowCaseSchema>;

export const workflowKindSchema = z.enum(['manual', 'cron', 'event']);
export type WorkflowKind = z.infer<typeof workflowKindSchema>;

export const workflowRunStatusSchema = z.enum(['queued', 'running', 'done', 'failed']);
export type WorkflowRunStatus = z.infer<typeof workflowRunStatusSchema>;

export const workflowNodeSchema = z.object({
  id: z.string(),
  kind: workflowNodeKindSchema,
  position: z.object({ x: z.number(), y: z.number() }),
  /** Per-kind config. Kept loose (like Dify's node `data`); interpreted by the runner. */
  data: z.record(z.string(), z.unknown()).default({}),
});

export type WorkflowNode = z.infer<typeof workflowNodeSchema>;

/**
 * Edges connect nodes. `label` carries the source handle:
 *   - undefined / 'source' : default flow
 *   - 'true' / 'false'     : if_else branches
 *   - 'success' / 'error'  : fail-branch for code / http_request
 */
export const workflowEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  label: z.string().optional(),
});

export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;

export const workflowDefinitionSchema = z.object({
  nodes: z.array(workflowNodeSchema).default([]),
  edges: z.array(workflowEdgeSchema).default([]),
});

export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

export const workflowSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  userId: z.string(),
  name: z.string(),
  kind: workflowKindSchema,
  enabled: z.boolean(),
  cron: z.string().nullable().optional(),
  timezone: z.string().nullable().optional(),
  sourceType: z.union([z.literal('cron'), z.string().min(1)]).optional(),
  eventOn: z.union([z.string(), z.array(z.string())]).optional(),
  eventFilter: z.string().optional(),
  definition: workflowDefinitionSchema,
  createdAt: z.string().optional(),
  lastRunAt: z.string().nullable().optional(),
});

export type Workflow = z.infer<typeof workflowSchema>;

export const workflowInputSchema = z.object({
  name: z.string().min(1),
  kind: workflowKindSchema.default('manual'),
  enabled: z.boolean().default(true),
  cron: z.string().optional(),
  timezone: z.string().default('UTC'),
  sourceType: z.union([z.literal('cron'), z.string().min(1)]).optional(),
  eventOn: z.union([z.string(), z.array(z.string())]).optional(),
  eventFilter: z.string().optional(),
  definition: workflowDefinitionSchema.default({ nodes: [], edges: [] }),
});

export type WorkflowInput = z.infer<typeof workflowInputSchema>;

export const workflowRunLogEntrySchema = z.object({
  nodeId: z.string(),
  kind: workflowNodeKindSchema,
  status: z.enum(['ok', 'error', 'skipped']),
  message: z.string(),
  output: z.unknown().optional(),
  at: z.string(),
});

export type WorkflowRunLogEntry = z.infer<typeof workflowRunLogEntrySchema>;

export const workflowRunSchema = z.object({
  id: z.string().uuid(),
  workflowId: z.string().uuid(),
  tenantId: z.string().uuid(),
  status: workflowRunStatusSchema,
  log: z.array(workflowRunLogEntrySchema).default([]),
  eventContext: z.record(z.string(), z.unknown()).default({}),
  startedAt: z.string(),
  finishedAt: z.string().nullable().optional(),
});

export type WorkflowRun = z.infer<typeof workflowRunSchema>;

/** Node metadata for UI palettes (label + category). */
export interface WorkflowNodeMeta {
  kind: WorkflowNodeKind;
  label: string;
  category: 'trigger' | 'logic' | 'transform' | 'integration' | 'ai' | 'data' | 'output';
}

export const WORKFLOW_NODE_META: WorkflowNodeMeta[] = [
  { kind: 'start', label: 'Start', category: 'trigger' },
  { kind: 'if_else', label: 'Condition', category: 'logic' },
  { kind: 'set', label: 'Field mapping', category: 'transform' },
  { kind: 'template', label: 'Template text', category: 'transform' },
  { kind: 'code', label: 'Code (JS)', category: 'transform' },
  { kind: 'http_request', label: 'HTTP request', category: 'integration' },
  { kind: 'run_agent', label: 'Run agent', category: 'ai' },
  { kind: 'knowledge_retrieval', label: 'Knowledge retrieval', category: 'ai' },
  { kind: 'table_read', label: 'Read table', category: 'data' },
  { kind: 'table_write', label: 'Write table', category: 'data' },
  { kind: 'end', label: 'Output', category: 'output' },
];
