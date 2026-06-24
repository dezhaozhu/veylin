export type MembershipRole = 'owner' | 'admin' | 'member';
export type TaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export type AutomationKind = 'schedule' | 'event';
export type WorkflowKind = 'manual' | 'schedule' | 'event';
export type WorkflowRunStatus = 'queued' | 'running' | 'done' | 'failed';
export type AutomationRunStatus = 'queued' | 'running' | 'done' | 'failed';
export type RuleTrigger = 'always' | 'keyword';
export type McpTransport = 'sse' | 'http';
export type WebhookSourceType = 'github' | 'custom';

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
  workingMemory?: string | null;
  title?: string | null;
  updatedAt?: string;
}

export interface TenantSettingsRow {
  tenantId: string;
  disabledSkills: string[];
  disabledMcpServers: string[];
  modelSettings?: {
    openaiApiKeyEnabled?: boolean;
    openaiApiKey?: string;
    overrideOpenAIBaseUrl?: boolean;
    openaiBaseUrl?: string;
  };
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
  triggerFilter: Record<string, unknown>;
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
  token: string;
  secret: string;
  sourceType: WebhookSourceType;
  createdAt?: string;
}

export interface ScheduleSheetRow {
  id: string;
  name: string;
  builtin: boolean;
}

export interface ScheduleColumnRow {
  sheetId: string;
  key: string;
  name: string;
  width: number;
  type: string;
  frozen?: boolean;
  deletable: boolean;
  position: number;
}

export interface ScheduleRowRecord {
  sheetId: string;
  rowKey: string;
  data: Record<string, string | number>;
}

export interface DocumentRow {
  id: string;
  tenantId: string;
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
  text: string;
  source: string;
  offset: number;
  embedding?: number[] | null;
}

export interface EntityRow {
  id: string;
  tenantId: string;
  name: string;
  type: string;
  documentId?: string | null;
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
  name: string;
  kind: WorkflowKind;
  enabled: boolean;
  cron?: string | null;
  timezone?: string | null;
  sourceType?: string | null;
  triggerFilter: Record<string, unknown>;
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
