import vm from 'node:vm';
import type { Runtime } from '@veylin/runtime';
import {
  type WorkflowCase,
  type WorkflowEdge,
  type WorkflowNode,
  type WorkflowNodeKind,
  type WorkflowRunLogEntry,
  DEFAULT_AGENT_ID,
} from '@veylin/shared';
import type { WorkflowJob, QueuePort } from './queue';
import { WORKFLOW_QUEUE } from './queue';
import { runAgentPrompt } from './agent-run';
import { searchKnowledge } from './rag-store';
import { listTableRows, updateTableRow, DEFAULT_TABLE_SHEET } from './table-store';
import { ensureThreadState, setThreadTitle } from './thread-state';
import {
  evaluateCase,
  interpolate,
  interpolateDeep,
  resolveValue,
  type NodeContext,
} from './workflow-expr';
import {
  createWorkflowRun,
  getWorkflow,
  touchWorkflowLastRun,
  updateWorkflowRun,
} from './workflow-store';

type NodeOutcome = 'true' | 'false' | 'success' | 'error';

interface ExecResult {
  output: unknown;
  outcome: NodeOutcome;
}

function nodeData(node: WorkflowNode): Record<string, unknown> {
  return (node.data as Record<string, unknown>) ?? {};
}

/** Parse headers/params from "Key: value" lines or a JSON object expression. */
function parseKeyValueBlock(raw: string, ctx: NodeContext): Record<string, string> {
  const text = raw.trim();
  if (!text) return {};
  if (text.startsWith('{')) {
    try {
      const obj = interpolateDeep(JSON.parse(text), ctx) as Record<string, unknown>;
      return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, String(v)]));
    } catch {
      /* fall through to line parsing */
    }
  }
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = interpolate(line.slice(idx + 1).trim(), ctx);
    if (key) out[key] = val;
  }
  return out;
}

function runUserCode(code: string, inputs: Record<string, unknown>): unknown {
  const logs: unknown[] = [];
  const sandbox: Record<string, unknown> = {
    inputs,
    console: { log: (...args: unknown[]) => logs.push(args) },
    JSON,
    Math,
    Date,
    result: undefined,
  };
  vm.createContext(sandbox);
  const wrapped = `result = (function(inputs){ "use strict";\n${code}\n})(inputs);`;
  vm.runInContext(wrapped, sandbox, { timeout: 2000 });
  return sandbox.result;
}

async function executeNode(
  runtime: Runtime,
  node: WorkflowNode,
  kind: WorkflowNodeKind,
  ctx: NodeContext,
  eventContext: Record<string, unknown>,
  tenantId: string,
  userId: string,
  workflowName: string,
): Promise<unknown> {
  const data = nodeData(node);
  switch (kind) {
    case 'start':
      return { event: eventContext, ...eventContext };

    case 'if_else': {
      const cases = (data.cases as WorkflowCase[]) ?? [];
      const matched = cases.length === 0 ? true : evaluateCase(ctx, cases[0]!);
      return { result: matched };
    }

    case 'set': {
      const fields = (data.fields as Array<{ name: string; value: string }>) ?? [];
      const out: Record<string, unknown> = {};
      for (const f of fields) {
        if (!f?.name) continue;
        out[f.name] = resolveValue(ctx, String(f.value ?? ''));
      }
      return out;
    }

    case 'template': {
      const text = interpolate(String(data.template ?? ''), ctx);
      return { text };
    }

    case 'code': {
      const code = String(data.code ?? '');
      const inputDefs = (data.inputs as Array<{ name: string; value: string }>) ?? [];
      const inputs: Record<string, unknown> = {};
      for (const def of inputDefs) {
        if (!def?.name) continue;
        inputs[def.name] = resolveValue(ctx, String(def.value ?? ''));
      }
      const result = runUserCode(code, inputs);
      return result && typeof result === 'object' ? result : { result };
    }

    case 'http_request': {
      const method = String(data.method ?? 'GET').toUpperCase();
      const url = interpolate(String(data.url ?? ''), ctx);
      if (!url) throw new Error('http_request requires url');
      const headers = parseKeyValueBlock(String(data.headers ?? ''), ctx);
      const auth = data.auth as { type?: string; token?: string; apiKey?: string; header?: string } | undefined;
      if (auth?.type === 'bearer' && auth.token) {
        headers['Authorization'] = `Bearer ${interpolate(auth.token, ctx)}`;
      } else if (auth?.type === 'apiKey' && auth.apiKey) {
        headers[auth.header || 'X-API-Key'] = interpolate(auth.apiKey, ctx);
      }
      let body: string | undefined;
      if (!['GET', 'HEAD'].includes(method) && data.body != null && data.body !== '') {
        body = interpolate(String(data.body), ctx);
        if (!headers['Content-Type'] && !headers['content-type']) {
          headers['Content-Type'] = 'application/json';
        }
      }
      const controller = new AbortController();
      const timeoutMs = Number(data.timeoutMs ?? 30000);
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, { method, headers, body, signal: controller.signal });
        const text = await res.text();
        let parsed: unknown = text;
        try {
          parsed = JSON.parse(text);
        } catch {
          /* keep raw text */
        }
        return {
          status_code: res.status,
          ok: res.ok,
          headers: Object.fromEntries(res.headers.entries()),
          body: parsed,
        };
      } finally {
        clearTimeout(timer);
      }
    }

    case 'knowledge_retrieval': {
      const query = interpolate(String(data.query ?? ''), ctx);
      if (!query.trim()) throw new Error('knowledge_retrieval requires query');
      const result = await searchKnowledge(tenantId, query);
      return { result: result.references, context: result.context };
    }

    case 'run_agent': {
      const prompt = interpolate(String(data.prompt ?? ''), ctx);
      if (!prompt.trim()) throw new Error('run_agent requires prompt');
      const agentId = String(data.agentId ?? DEFAULT_AGENT_ID);
      const threadId = `wf-${crypto.randomUUID()}`;
      await ensureThreadState({ threadId, tenantId, resourceId: userId });
      await setThreadTitle(threadId, `[Workflow] ${workflowName}`);
      const result = await runAgentPrompt({
        runtime,
        tenantId,
        userId,
        threadId,
        agentId,
        prompt,
        eventContext,
        title: workflowName,
      });
      return { text: result.text };
    }

    case 'table_read': {
      const sheetId = String(data.sheetId ?? DEFAULT_TABLE_SHEET);
      const rows = listTableRows(sheetId);
      return { sheetId, rows, count: rows.length };
    }

    case 'table_write': {
      const sheetId = String(data.sheetId ?? DEFAULT_TABLE_SHEET);
      const rowKey = interpolate(String(data.rowKey ?? ''), ctx);
      const rawPatch = (data.patch as Record<string, unknown>) ?? {};
      const patch = interpolateDeep(rawPatch, ctx) as Record<string, string | number>;
      if (!rowKey) throw new Error('table_write requires rowKey');
      const updated = await updateTableRow(rowKey, patch, sheetId);
      if (!updated) throw new Error(`dataset row not found: ${rowKey}`);
      return { sheetId, row: updated };
    }

    case 'end': {
      const outputs = (data.outputs as Array<{ name: string; value: string }>) ?? [];
      if (outputs.length === 0) return { outputs: ctx };
      const out: Record<string, unknown> = {};
      for (const o of outputs) {
        if (!o?.name) continue;
        out[o.name] = resolveValue(ctx, String(o.value ?? ''));
      }
      return { outputs: out };
    }

    default:
      throw new Error(`unsupported node kind: ${kind}`);
  }
}

function supportsFailBranch(kind: WorkflowNodeKind): boolean {
  return kind === 'code' || kind === 'http_request';
}

/** Pick which outgoing edges to follow given a node's outcome. */
function selectEdges(
  edges: WorkflowEdge[],
  nodeId: string,
  kind: WorkflowNodeKind,
  outcome: NodeOutcome,
): WorkflowEdge[] {
  const out = edges.filter((e) => e.source === nodeId);
  if (kind === 'if_else') {
    const want = outcome === 'true' ? 'true' : 'false';
    return out.filter((e) => (e.label ?? '') === want);
  }
  if (supportsFailBranch(kind)) {
    if (outcome === 'error') return out.filter((e) => e.label === 'error');
    // success: any edge that is not the error branch
    return out.filter((e) => e.label !== 'error');
  }
  // default nodes: follow edges that are not branch-labeled
  return out.filter((e) => !['true', 'false', 'error'].includes(e.label ?? ''));
}

async function runNode(
  runtime: Runtime,
  node: WorkflowNode,
  kind: WorkflowNodeKind,
  ctx: NodeContext,
  eventContext: Record<string, unknown>,
  tenantId: string,
  userId: string,
  workflowName: string,
): Promise<ExecResult> {
  try {
    const output = await executeNode(
      runtime,
      node,
      kind,
      ctx,
      eventContext,
      tenantId,
      userId,
      workflowName,
    );
    let outcome: NodeOutcome = 'success';
    if (kind === 'if_else') {
      outcome = (output as { result?: boolean })?.result ? 'true' : 'false';
    }
    return { output, outcome };
  } catch (err) {
    const data = nodeData(node);
    if (supportsFailBranch(kind) && data.errorStrategy === 'fail-branch') {
      return {
        output: { error_message: String(err), error_type: (err as Error)?.name ?? 'Error' },
        outcome: 'error',
      };
    }
    throw err;
  }
}

export async function runWorkflowJob(runtime: Runtime, job: WorkflowJob): Promise<void> {
  const workflow = await getWorkflow(job.tenantId, job.workflowId);
  if (!workflow || !workflow.enabled) return;

  const run = await createWorkflowRun(workflow.id, job.tenantId, job.eventContext ?? {});
  const log: WorkflowRunLogEntry[] = [];
  const ctx: NodeContext = {};

  const appendLog = async (entry: Omit<WorkflowRunLogEntry, 'at'>) => {
    log.push({ ...entry, at: new Date().toISOString() });
    await updateWorkflowRun(run.id, { status: 'running', log: [...log] });
  };

  await updateWorkflowRun(run.id, { status: 'running' });

  const { nodes, edges } = workflow.definition;
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const roots = nodes.filter((n) => n.kind === 'start');
  const startNodes = roots.length > 0 ? roots : nodes.filter((n) => !edges.some((e) => e.target === n.id));

  if (startNodes.length === 0) {
    await appendLog({
      nodeId: '_',
      kind: 'start',
      message: 'No entry node (missing a start node)',
      status: 'error',
    });
    await updateWorkflowRun(run.id, {
      status: 'failed',
      log,
      finishedAt: new Date().toISOString(),
    });
    return;
  }

  const visited = new Set<string>();
  const queue: WorkflowNode[] = [...startNodes];
  let failed = false;

  try {
    while (queue.length > 0) {
      const node = queue.shift()!;
      if (visited.has(node.id)) continue;
      visited.add(node.id);
      const kind = node.kind as WorkflowNodeKind;

      try {
        const { output, outcome } = await runNode(
          runtime,
          node,
          kind,
          ctx,
          job.eventContext ?? {},
          job.tenantId,
          workflow.userId,
          workflow.name,
        );
        ctx[node.id] = output;
        await appendLog({
          nodeId: node.id,
          kind: node.kind,
          message:
            kind === 'if_else'
              ? `Condition result: ${outcome}`
              : outcome === 'error'
                ? 'Failed (took error branch)'
                : `${kind} completed`,
          output,
          status: outcome === 'error' ? 'error' : 'ok',
        });

        for (const edge of selectEdges(edges, node.id, kind, outcome)) {
          const next = nodeMap.get(edge.target);
          if (next && !visited.has(next.id)) queue.push(next);
        }
      } catch (err) {
        failed = true;
        await appendLog({
          nodeId: node.id,
          kind: node.kind,
          message: String(err),
          status: 'error',
        });
        break;
      }
    }

    await updateWorkflowRun(run.id, {
      status: failed ? 'failed' : 'done',
      log,
      finishedAt: new Date().toISOString(),
    });
    if (!failed) await touchWorkflowLastRun(workflow.id, job.tenantId);
  } catch (err) {
    await updateWorkflowRun(run.id, {
      status: 'failed',
      log,
      finishedAt: new Date().toISOString(),
    });
    throw err;
  }
}

export async function dispatchWorkflow(
  boss: QueuePort,
  job: WorkflowJob,
): Promise<string | null> {
  return boss.send(WORKFLOW_QUEUE, job);
}
