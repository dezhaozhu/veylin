export type MembershipRole = 'owner' | 'admin' | 'member';
export type TaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export type AutomationKind = 'cron' | 'event';
export type WorkflowKind = 'manual' | 'cron' | 'event';
export type WorkflowRunStatus = 'queued' | 'running' | 'done' | 'failed';
export type AutomationRunStatus = 'queued' | 'running' | 'done' | 'failed';
export type RuleTrigger = 'always' | 'keyword';
export type McpTransport = 'sse' | 'http';

export interface TenantRow {
  id: string;
  name: string;
  createdAt?: string;
}

export interface MembershipRow {
  id: string;
  userId: string;
  tenantId: string;
  role: MembershipRole;
  createdAt?: string;
}

export interface AgentRow {
  id: string;
  tenantId: string;
  name: string;
  definition: unknown;
  createdAt?: string;
}

export interface AuditLogRow {
  id: string;
  tenantId: string;
  userId?: string | null;
  threadId?: string | null;
  action: string;
  detail?: unknown;
  createdAt?: string;
}

export interface TaskRow {
  id: string;
  tenantId: string;
  parentThreadId?: string | null;
  agentId: string;
  prompt: string;
  status: TaskStatus;
  label?: string | null;
  result?: string | null;
  jobId?: string | null;
  workerThreadId?: string | null;
  subagentType?: string | null;
  totalTokens?: number | null;
  durationMs?: number | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CheckpointRow {
  id: string;
  tenantId: string;
  threadId: string;
  label: string;
  snapshot: unknown;
  createdAt?: string;
}

export interface ThreadStateRow {
  threadId: string;
  tenantId: string;
  resourceId: string;
  planMode: boolean;
  todos: unknown[];
  activatedSkills: Record<string, string>;
  pinnedSkills: string[];
  workingMemory?: string | null;
  title?: string | null;
  goal?: unknown | null;
  loop?: unknown | null;
  updatedAt?: string;
}

export interface TenantSettingsRow {
  tenantId: string;
  disabledSkills: string[];
  disabledMcpServers: string[];
  disabledHooks: string[];
  modelSettings?: {
    modelName?: string;
    requestUrl?: string;
    apiKey?: string;
  };
  langfuseSettings?: {
    enabled?: boolean;
    publicKey?: string;
    secretKey?: string;
    baseUrl?: string;
  };
  workspaceRoot?: string | null;
  importClaudeHooks?: boolean;
  updatedAt?: string;
}

export interface CustomSkillRow {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  content: string;
  enabled: boolean;
  createdAt?: string;
}

export interface RuleRow {
  id: string;
  tenantId: string;
  userId?: string | null;
  agentId?: string | null;
  name: string;
  content: string;
  trigger: RuleTrigger;
  keywords: string[];
  enabled: boolean;
  createdAt?: string;
}

export interface McpServerRow {
  id: string;
  tenantId: string;
  name: string;
  transport: McpTransport;
  url: string;
  headers: Record<string, string>;
  enabled: boolean;
  createdAt?: string;
}

export interface AutomationRow {
  id: string;
  tenantId: string;
  userId: string;
  name: string;
  kind: AutomationKind;
  agentId: string;
  prompt: string;
  enabled: boolean;
  cron?: string | null;
  timezone?: string | null;
  sourceType?: string | null;
  eventOn?: string | string[] | null;
  eventFilter?: string | null;
  createdAt?: string;
  lastRunAt?: string | null;
}

export interface AutomationRunRow {
  id: string;
  automationId: string;
  tenantId: string;
  threadId: string;
  status: AutomationRunStatus;
  result?: string | null;
  eventContext: Record<string, unknown>;
  startedAt: string;
  finishedAt?: string | null;
}

export interface WebhookEndpointRow {
  id: string;
  tenantId: string;
  name: string;
  source: string;
  secret: string;
  eventKeyExpr: string;
  signatureHeader: string;
  enabled: boolean;
  createdAt?: string;
}

export interface TableSheetRow {
  id: string;
  name: string;
  builtin: boolean;
  /** Chat session isolation key; null/absent = global (e.g. builtin main). */
  threadId?: string | null;
}

export interface TableColumnRow {
  sheetId: string;
  key: string;
  name: string;
  width: number;
  type: string;
  frozen?: boolean;
  deletable: boolean;
  position: number;
  statusOptions?: string[];
}

export interface TableRowRecord {
  sheetId: string;
  rowKey: string;
  data: Record<string, string | number>;
  /** Stable display order within the sheet (0-based). */
  position?: number;
}

export interface DocumentRow {
  id: string;
  tenantId: string;
  threadId: string;
  filename: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  status: 'pending' | 'indexing' | 'ready' | 'failed';
  error?: string | null;
  createdAt?: string;
}

export interface ChunkRow {
  id: string;
  documentId: string;
  tenantId: string;
  threadId: string;
  text: string;
  source: string;
  offset: number;
  embedding?: number[] | null;
}

export interface EntityRow {
  id: string;
  tenantId: string;
  threadId?: string | null;
  name: string;
  nameKey: string;
  type: string;
  description?: string | null;
  documentId?: string | null;
}

export interface AgentCitationRow {
  id: string;
  tenantId: string;
  threadId?: string | null;
  query: string;
  references: KnowledgeReference[];
  createdAt?: string;
}

export interface KnowledgeReference {
  refIndex: number;
  chunkId: string;
  documentId: string;
  source: string;
  text: string;
  offset: number;
  score?: number;
}

export interface RelatesRow {
  id: string;
  tenantId: string;
  fromEntityId: string;
  toEntityId: string;
  relation: string;
  documentId?: string | null;
}

export interface WorkflowRow {
  id: string;
  tenantId: string;
  userId: string;
  threadId: string;
  name: string;
  kind: WorkflowKind;
  enabled: boolean;
  cron?: string | null;
  timezone?: string | null;
  sourceType?: string | null;
  eventOn?: string | string[] | null;
  eventFilter?: string | null;
  definition: { nodes: unknown[]; edges: unknown[] };
  createdAt?: string;
  lastRunAt?: string | null;
}

export interface WorkflowRunRow {
  id: string;
  workflowId: string;
  tenantId: string;
  status: WorkflowRunStatus;
  log: unknown[];
  eventContext: Record<string, unknown>;
  startedAt: string;
  finishedAt?: string | null;
}
