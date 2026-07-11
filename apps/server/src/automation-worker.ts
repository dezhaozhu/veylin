import type { Runtime } from '@veylin/runtime';
import type { QueuePort } from './queue';
import { runAgentPrompt } from './agent-run';
import {
  getAutomation,
  createAutomationRun,
  updateAutomationRun,
  touchAutomationLastRun,
} from './automation-store';
import { ensureThreadState, setThreadTitle } from './thread-state';
import { AUTOMATION_QUEUE, type AutomationJob } from './queue';

export async function runAutomationJob(
  runtime: Runtime,
  job: AutomationJob,
): Promise<void> {
  const automation = await getAutomation(job.tenantId, job.automationId);
  if (!automation || !automation.enabled) return;

  const threadId = `auto-${job.automationId}-${crypto.randomUUID()}`;
  const tenantId = job.tenantId;
  const userId = automation.userId;
  const agentId = automation.agentId;

  await ensureThreadState({ threadId, tenantId, resourceId: userId });
  await setThreadTitle(threadId, `[Auto] ${automation.name}`);

  const run = await createAutomationRun(
    automation.id,
    tenantId,
    threadId,
    job.eventContext ?? {},
  );
  await updateAutomationRun(run.id, { status: 'running' });

  try {
    const result = await runAgentPrompt({
      runtime,
      tenantId,
      userId,
      threadId,
      agentId,
      prompt: automation.prompt,
      eventContext: job.eventContext,
      title: automation.name,
      automationId: automation.id,
    });

    await updateAutomationRun(run.id, {
      status: 'done',
      result: result.text,
      finishedAt: new Date().toISOString(),
    });
    await touchAutomationLastRun(tenantId, automation.id);
  } catch (err) {
    await updateAutomationRun(run.id, {
      status: 'failed',
      result: String(err),
      finishedAt: new Date().toISOString(),
    });
    throw err;
  }
}

export async function dispatchAutomation(
  boss: QueuePort,
  job: AutomationJob,
): Promise<string | null> {
  return boss.send(AUTOMATION_QUEUE, job);
}
