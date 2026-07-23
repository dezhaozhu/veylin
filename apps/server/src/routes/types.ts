import type { FastifyInstance } from 'fastify';
import type { Runtime } from '@veylin/runtime';
import type { QueuePort, SubagentJob, AutomationJob, WorkflowJob } from '../queue.js';
import type { TaskEvent } from '../task-events.js';
import type { McpHealthSnapshot } from '../mcp-health.js';
import type { RequestContext } from '../server-context.js';

export type TasksSnapshot = {
  tasks: Array<{
    id: string;
    status: string;
    label: string | null;
    agentId: string;
    subagentType: string | null;
    prompt: string | null;
    result: string | null;
    durationMs: number | null;
    totalTokens: number | null;
    toolUseCount?: number | null;
    lastToolName?: string | null;
    lastToolArgs?: string | null;
    currentActivity?: string | null;
  }>;
  batch?: {
    taskIds: string[];
    notificationsReady: boolean;
    synthesisReady: boolean;
    terminalCount: number;
    totalCount: number;
  };
};

/** Dependencies injected from server bootstrap into route modules. */
export interface ServerDeps {
  runtime: Runtime;
  queue: QueuePort;
  resolveContext: (headers: Record<string, string | string[] | undefined>) => Promise<RequestContext>;
  isForbiddenError: (err: unknown) => boolean;
  rebuildMcp: (tenantId: string) => Promise<void>;
  ensureMcpForTenant: (tenantId: string) => Promise<void>;
  getMcpToolsets: () => Record<string, unknown>;
  /** Server-name → project-group map for the tenant last resolved via rebuildMcp/ensureMcpForTenant. */
  getMcpGroups: () => Record<string, string | undefined>;
  getMcpToolIndex: () => { id: string; description: string }[];
  getTaskToolset: () => Record<string, unknown>;
  readTaskSnapshot: (
    threadId: string,
    ctx: RequestContext,
    batchIdsRaw?: string,
  ) => Promise<TasksSnapshot>;
  subscribeTaskEvents: (threadId: string, cb: (event: TaskEvent) => void) => () => void;
  mcpHealthByTenant: Map<string, McpHealthSnapshot>;
  RAG_UPLOAD_MAX_BYTES: number;
}

export type RouteRegistrar = (app: FastifyInstance, deps: ServerDeps) => void | Promise<void>;
