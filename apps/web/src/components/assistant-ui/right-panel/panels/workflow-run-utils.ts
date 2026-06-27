import type { Edge } from '@xyflow/react';

export type RunLogEntry = {
  nodeId: string;
  kind: string;
  status: string;
  message: string;
  at: string;
  output?: unknown;
};

export type WorkflowRunView = {
  id: string;
  status: string;
  log: RunLogEntry[];
  startedAt: string;
  finishedAt?: string | null;
  finalOutput?: unknown;
};

export type NodeRunStatus = 'ok' | 'error' | 'running' | 'pending';

export function nodeDisplayLabel(id: string, label?: string): string {
  const trimmed = label?.trim();
  if (trimmed) return trimmed;
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

export function upstreamNodeIds(nodeId: string, edges: Edge[]): string[] {
  const preds = new Set<string>();
  const queue = [nodeId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const edge of edges) {
      if (edge.target === id && !preds.has(edge.source)) {
        preds.add(edge.source);
        queue.push(edge.source);
      }
    }
  }
  return [...preds];
}

/** Next node that has not logged yet while a run is still active. */
export function nextPendingNodeId(run: WorkflowRunView, nodeIds: string[]): string | null {
  const executed = new Set(run.log.map((e) => e.nodeId));
  return nodeIds.find((id) => !executed.has(id)) ?? null;
}

export function buildNodeRunStatusMap(
  run: WorkflowRunView | null,
  nodeIds: string[],
): Map<string, NodeRunStatus> {
  const map = new Map<string, NodeRunStatus>();
  for (const id of nodeIds) map.set(id, 'pending');

  if (!run) return map;

  const logged = new Set<string>();
  for (const entry of run.log) {
    logged.add(entry.nodeId);
    map.set(entry.nodeId, entry.status === 'ok' ? 'ok' : 'error');
  }

  if (run.status === 'running') {
    const executed = run.log.map((e) => e.nodeId);
    const next = nodeIds.find((id) => !executed.includes(id));
    if (next) map.set(next, 'running');
  }

  return map;
}

export function formatWorkflowValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Prefer human-readable text for Result panel (Agent reply, template, etc.). */
export function primaryTextOutput(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return null;

  const obj = value as Record<string, unknown>;
  if (typeof obj.text === 'string' && obj.text.trim()) return obj.text;

  if (obj.outputs && typeof obj.outputs === 'object') {
    const outs = obj.outputs as Record<string, unknown>;
    for (const v of Object.values(outs)) {
      if (typeof v === 'string' && v.trim()) return v;
      if (v && typeof v === 'object' && typeof (v as { text?: string }).text === 'string') {
        const text = (v as { text: string }).text;
        if (text.trim()) return text;
      }
    }
  }

  return null;
}

export const OUTPUT_FIELD_HINTS: Record<string, string[]> = {
  start: ['event'],
  if_else: ['result'],
  set: [],
  template: ['text'],
  code: ['result'],
  http_request: ['body', 'status_code', 'ok'],
  knowledge_retrieval: ['context', 'result'],
  run_agent: ['text'],
  table_read: ['rows', 'count', 'sheetId'],
  table_write: ['row', 'sheetId'],
  end: ['outputs'],
};

export function suggestedVarRefs(
  nodeId: string,
  kind: string,
  lastOutput?: unknown,
): string[] {
  const hints = OUTPUT_FIELD_HINTS[kind] ?? [];
  const refs = hints.map((field) => `{{ ${nodeId}.${field} }}`);

  if (lastOutput && typeof lastOutput === 'object' && !Array.isArray(lastOutput)) {
    for (const key of Object.keys(lastOutput as Record<string, unknown>)) {
      const ref = `{{ ${nodeId}.${key} }}`;
      if (!refs.includes(ref)) refs.push(ref);
    }
  }

  if (refs.length === 0) refs.push(`{{ ${nodeId} }}`);
  return refs;
}

export function nextSequentialNodeId(existingIds: Iterable<string>): string {
  const used = new Set(existingIds);
  let i = 1;
  while (used.has(`n${i}`)) i += 1;
  return `n${i}`;
}
