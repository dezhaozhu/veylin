/**
 * E2E: dispatch 2 background agents → panel states → auto-synthesis to completion.
 * Run: node apps/web/scripts/e2e-multi-agent-flow.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.VEYLIN_E2E_BASE ?? 'http://127.0.0.1:5174';
const API = process.env.VEYLIN_E2E_API ?? 'http://127.0.0.1:8787';
const MAX_WAIT_MS = Number(process.env.VEYLIN_E2E_MAX_MS ?? 600_000);
const POLL_MS = 3_000;

const PROMPT =
  'Dispatch exactly 2 explore background subagents (run_in_background=true) with short tasks: ' +
  '"Analyze dimension A" and "Analyze dimension B". ' +
  'Use TodoWrite with 2 todos, dispatch both agents, then stop — do not wait for results.';

function log(step, detail) {
  console.log(`[e2e] ${step}${detail ? `: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
}

async function apiJson(path) {
  const res = await fetch(`${API}${path}`, { credentials: 'include' });
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json();
}

async function readUiState(page) {
  return page.evaluate(() => {
    const text = document.body.innerText;
    const agentsHeading = /智能体 \(|Agents \(/i.test(text);
    const todosHeading = /待办 \(|Todos \(/i.test(text);
    const queued = /已排队|Queued/i.test(text);
    const running = /运行中|Running/i.test(text);
    const done = /已完成|Done/i.test(text);
    const providerError = /模型 API 连接中断|Connection failed：.*AI_APICallError|reasoning-end for missing reasoning/i.test(text);
    const isRunning = text.includes('Stop') || text.includes('停止');
    const assistantBlocks = document.querySelectorAll('[data-role="assistant"]').length;
    return {
      agentsHeading,
      todosHeading,
      queued,
      running,
      done,
      providerError,
      isRunning,
      assistantBlocks,
      excerpt: text.slice(-1200),
    };
  });
}

async function main() {
  const health = await fetch(`${API}/health`);
  if (!health.ok) throw new Error('Server not ready on :8787');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(120_000);

  let chatThreadId = null;
  page.on('request', (req) => {
    if (req.method() !== 'POST' || !req.url().includes('/api/chat')) return;
    try {
      const body = req.postDataJSON();
      if (body?.id) chatThreadId = body.id;
    } catch {
      // ignore
    }
  });

  const started = Date.now();
  const report = { phases: [], bugs: [] };

  log('open', BASE);
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 120_000 });
  await page.waitForFunction(
    () => document.body.innerText.includes('Send message') || document.body.innerText.includes('发送消息'),
    null,
    { timeout: 60_000 },
  );

  log('dispatch', PROMPT.slice(0, 80) + '…');
  await page.locator('textarea').first().fill(PROMPT);
  await page.getByRole('button', { name: /Send message|发送消息/i }).first().click();

  // Phase 1: panel appears with >=2 agents
  let panelOk = false;
  while (Date.now() - started < MAX_WAIT_MS && !panelOk) {
    const ui = await readUiState(page);
    if (ui.agentsHeading && (ui.queued || ui.running)) {
      panelOk = true;
      report.phases.push({ phase: 'panel_dispatch', ui, at: Date.now() - started });
      log('panel_dispatch', ui);
      break;
    }
    await page.waitForTimeout(POLL_MS);
  }
  if (!panelOk) {
    report.bugs.push('Panel did not show agents after dispatch');
  }

  // Resolve thread id
  let threadId = chatThreadId;
  if (!threadId) {
    const threads = await apiJson('/api/threads');
    threadId = threads.threads?.[0]?.remoteId;
  }
  log('threadId', threadId ?? 'unknown');

  // Phase 2: API tasks match batch
  let tasksTerminal = false;
  let lastTasks = [];
  let notificationsReady = false;
  while (Date.now() - started < MAX_WAIT_MS && !tasksTerminal) {
    if (threadId) {
      const data = await apiJson(`/api/tasks?threadId=${encodeURIComponent(threadId)}`);
      lastTasks = data.tasks ?? [];
      const active = lastTasks.filter((t) => t.status === 'queued' || t.status === 'running');
      const batch = lastTasks.filter((t) => t.status === 'queued' || t.status === 'running' || t.status === 'done' || t.status === 'failed');
      if (batch.length >= 2 && active.length === 0 && batch.every((t) => ['done', 'failed', 'cancelled'].includes(t.status))) {
        tasksTerminal = true;
        const batchIds = batch.map((t) => t.id).join(',');
        const readyData = await apiJson(
          `/api/tasks?threadId=${encodeURIComponent(threadId)}&batchIds=${encodeURIComponent(batchIds)}`,
        );
        notificationsReady = Boolean(
          readyData.batch?.notificationsReady ?? readyData.batch?.synthesisReady,
        );
        report.phases.push({
          phase: 'tasks_terminal',
          taskCount: batch.length,
          notificationsReady,
          statuses: batch.map((t) => ({ id: t.id.slice(0, 8), status: t.status })),
          at: Date.now() - started,
        });
        log('tasks_terminal', { count: batch.length, notificationsReady });
      }
    }
    const ui = await readUiState(page);
    if (ui.providerError) {
      report.bugs.push('Provider error visible in UI before synthesis');
      log('provider_error', ui.excerpt.slice(-300));
    }
    await page.waitForTimeout(POLL_MS);
  }
  if (!tasksTerminal) {
    report.bugs.push('Tasks did not all reach terminal state in time');
  }

  // Phase 3: synthesis — new assistant content or settled running state
  let synthesisOk = false;
  const dispatchTextMarker = /dimension A|dimension B|Analyze dimension|分析.*维|派发|dispatch/i;
  let baselineAssistantLen = 0;
  await page.waitForTimeout(2000);
  baselineAssistantLen = await page.evaluate(
    () => document.body.innerText.length,
  );

  while (Date.now() - started < MAX_WAIT_MS && !synthesisOk) {
    const ui = await readUiState(page);
    const bodyLen = await page.evaluate(() => document.body.innerText.length);
    const hasSynthesisText = await page.evaluate(() => {
      const t = document.body.innerText;
      // Exclude dispatch-only boilerplate that mentions future synthesis.
      if (/结果将在完成后通过通知送达|届时.*综合结论/.test(t)) return false;
      return /综合报告|综合分析|汇总报告|总结如下|synthesis report|summary report/i.test(t);
    });

    if (
      tasksTerminal &&
      notificationsReady &&
      !ui.isRunning &&
      (hasSynthesisText || bodyLen > baselineAssistantLen + 80 || ui.assistantBlocks >= 2)
    ) {
      synthesisOk = true;
      report.phases.push({ phase: 'synthesis_done', ui, bodyLen, at: Date.now() - started });
      log('synthesis_done', { bodyLen, hasSynthesisText });
      break;
    }

    if (tasksTerminal && notificationsReady && ui.isRunning) {
      log('synthesis_streaming', 'coordinator still running — waiting');
    }

    await page.waitForTimeout(POLL_MS);
  }
  if (!synthesisOk) {
    const ui = await readUiState(page);
    report.bugs.push('Synthesis did not complete (no summary / still running)');
    report.phases.push({ phase: 'synthesis_timeout', ui, at: Date.now() - started });
  }

  // Phase 4: panel still shows completed agents (not vanished)
  const finalUi = await readUiState(page);
  if (tasksTerminal && !finalUi.agentsHeading && lastTasks.length >= 2) {
    report.bugs.push('Agent panel missing after tasks completed');
  } else if (finalUi.agentsHeading) {
    report.phases.push({ phase: 'panel_after_done', ui: finalUi, at: Date.now() - started });
  }

  await browser.close();

  const pass = report.bugs.length === 0;
  console.log('\n=== E2E REPORT ===');
  console.log(JSON.stringify({ pass, elapsedMs: Date.now() - started, ...report }, null, 2));
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error('[e2e] fatal', err);
  process.exit(1);
});
