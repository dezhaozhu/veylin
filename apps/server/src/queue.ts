import PQueue from 'p-queue';
import cron, { type ScheduledTask } from 'node-cron';

export const SUBAGENT_QUEUE = 'subagent-task';
export const AUTOMATION_QUEUE = 'automation-run';
export const WORKFLOW_QUEUE = 'workflow-run';

export interface SubagentJob {
  tenantId: string;
  threadId: string;
  agentId: string;
  prompt: string;
  parentThreadId?: string;
  parentResource?: string;
  label?: string;
  taskId?: string;
}

export interface AutomationJob {
  tenantId: string;
  automationId: string;
  eventContext?: Record<string, unknown>;
}

export interface WorkflowJob {
  tenantId: string;
  workflowId: string;
  eventContext?: Record<string, unknown>;
}

export interface ScheduleSpec {
  name: string;
  cron: string;
  job: SubagentJob;
}

export interface QueuePort {
  send(queue: string, job: SubagentJob | AutomationJob | WorkflowJob): Promise<string | null>;
  cancel(queue: string, jobId: string): Promise<void>;
  registerWorkers(handler: (job: SubagentJob) => Promise<void>): Promise<void>;
  registerAutomationWorkers(handler: (job: AutomationJob) => Promise<void>): Promise<void>;
  registerWorkflowWorkers(handler: (job: WorkflowJob) => Promise<void>): Promise<void>;
  registerSchedules(schedules: ScheduleSpec[]): Promise<void>;
  registerAutomationSchedule(
    automationId: string,
    cronExpr: string,
    timezone: string,
    job: AutomationJob,
  ): Promise<void>;
  unregisterAutomationSchedule(automationId: string): Promise<void>;
  registerWorkflowSchedule(
    workflowId: string,
    cronExpr: string,
    timezone: string,
    job: WorkflowJob,
  ): Promise<void>;
  unregisterWorkflowSchedule(workflowId: string): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

type TrackedJob = {
  queue: string;
  data: SubagentJob | AutomationJob | WorkflowJob;
  cancelled: boolean;
};

export function createInProcQueue(): QueuePort {
  const subagentQueue = new PQueue({ concurrency: 2 });
  const jobs = new Map<string, TrackedJob>();
  const cronTasks = new Map<string, ScheduledTask>();
  let subagentHandler: ((job: SubagentJob) => Promise<void>) | null = null;
  let automationHandler: ((job: AutomationJob) => Promise<void>) | null = null;
  let workflowHandler: ((job: WorkflowJob) => Promise<void>) | null = null;
  let jobCounter = 0;

  const nextJobId = () => `job-${++jobCounter}-${Date.now()}`;

  const reportJobError = (queue: string) => (err: unknown) => {
    console.error(`[queue] job failed on ${queue}:`, err);
  };

  const port: QueuePort = {
    async start() {
      /* no-op */
    },
    async stop() {
      for (const task of cronTasks.values()) task.stop();
      cronTasks.clear();
      subagentQueue.clear();
    },
    async send(queue, job) {
      const id = nextJobId();
      jobs.set(id, { queue, data: job, cancelled: false });
      const run = async () => {
        const tracked = jobs.get(id);
        if (!tracked || tracked.cancelled) return;
        if (queue === SUBAGENT_QUEUE && subagentHandler) {
          await subagentHandler(job as SubagentJob);
        } else if (queue === AUTOMATION_QUEUE && automationHandler) {
          await automationHandler(job as AutomationJob);
        } else if (queue === WORKFLOW_QUEUE && workflowHandler) {
          await workflowHandler(job as WorkflowJob);
        }
      };
      if (queue === SUBAGENT_QUEUE) {
        void subagentQueue.add(run).catch(reportJobError(queue));
      } else {
        void run().catch(reportJobError(queue));
      }
      return id;
    },
    async cancel(_queue, jobId) {
      const tracked = jobs.get(jobId);
      if (tracked) tracked.cancelled = true;
    },
    async registerWorkers(handler) {
      subagentHandler = handler;
    },
    async registerAutomationWorkers(handler) {
      automationHandler = handler;
    },
    async registerWorkflowWorkers(handler) {
      workflowHandler = handler;
    },
    async registerSchedules(schedules) {
      for (const s of schedules) {
        const key = `schedule:${s.name}`;
        cronTasks.get(key)?.stop();
        const task = cron.schedule(
          s.cron,
          () => {
            void port.send(SUBAGENT_QUEUE, s.job).catch(reportJobError(SUBAGENT_QUEUE));
          },
          { timezone: 'UTC' },
        );
        cronTasks.set(key, task);
      }
    },
    async registerAutomationSchedule(automationId, cronExpr, timezone, job) {
      const key = `auto:${automationId}`;
      cronTasks.get(key)?.stop();
      const task = cron.schedule(
        cronExpr,
        () => {
          void port.send(AUTOMATION_QUEUE, job).catch(reportJobError(AUTOMATION_QUEUE));
        },
        { timezone },
      );
      cronTasks.set(key, task);
    },
    async unregisterAutomationSchedule(automationId) {
      const key = `auto:${automationId}`;
      cronTasks.get(key)?.stop();
      cronTasks.delete(key);
    },
    async registerWorkflowSchedule(workflowId, cronExpr, timezone, job) {
      const key = `wf:${workflowId}`;
      cronTasks.get(key)?.stop();
      const task = cron.schedule(
        cronExpr,
        () => {
          void port.send(WORKFLOW_QUEUE, job).catch(reportJobError(WORKFLOW_QUEUE));
        },
        { timezone },
      );
      cronTasks.set(key, task);
    },
    async unregisterWorkflowSchedule(workflowId) {
      const key = `wf:${workflowId}`;
      cronTasks.get(key)?.stop();
      cronTasks.delete(key);
    },
  };

  return port;
}

/** @deprecated Use createInProcQueue; kept for import compatibility. */
export async function createQueue(_connectionString?: string): Promise<QueuePort> {
  const q = createInProcQueue();
  await q.start();
  return q;
}

export async function registerWorkers(
  boss: QueuePort,
  handler: (job: SubagentJob) => Promise<void>,
): Promise<void> {
  await boss.registerWorkers(handler);
}

export async function registerSchedules(boss: QueuePort, schedules: ScheduleSpec[]): Promise<void> {
  await boss.registerSchedules(schedules);
}

export function automationScheduleName(automationId: string): string {
  return `auto:${automationId}`;
}

export function workflowScheduleName(workflowId: string): string {
  return `wf:${workflowId}`;
}

export async function registerAutomationSchedule(
  boss: QueuePort,
  automationId: string,
  cronExpr: string,
  timezone: string,
  job: AutomationJob,
): Promise<void> {
  await boss.registerAutomationSchedule(automationId, cronExpr, timezone, job);
}

export async function unregisterAutomationSchedule(
  boss: QueuePort,
  automationId: string,
): Promise<void> {
  await boss.unregisterAutomationSchedule(automationId);
}

export async function registerWorkflowSchedule(
  boss: QueuePort,
  workflowId: string,
  cronExpr: string,
  timezone: string,
  job: WorkflowJob,
): Promise<void> {
  await boss.registerWorkflowSchedule(workflowId, cronExpr, timezone, job);
}

export async function unregisterWorkflowSchedule(
  boss: QueuePort,
  workflowId: string,
): Promise<void> {
  await boss.unregisterWorkflowSchedule(workflowId);
}

export async function registerAutomationWorkers(
  boss: QueuePort,
  handler: (job: AutomationJob) => Promise<void>,
): Promise<void> {
  await boss.registerAutomationWorkers(handler);
}

export async function registerWorkflowWorkers(
  boss: QueuePort,
  handler: (job: WorkflowJob) => Promise<void>,
): Promise<void> {
  await boss.registerWorkflowWorkers(handler);
}
