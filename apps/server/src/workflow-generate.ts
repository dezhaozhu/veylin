import { DEFAULT_MODEL, getModelConfig } from '@veylin/runtime';
import {
  DEFAULT_AGENT_ID,
  WORKFLOW_NODE_META,
  workflowDefinitionSchema,
  type WorkflowDefinition,
} from '@veylin/shared';
import { z } from 'zod';
import { applyTenantModelSettings } from './model-settings-store';

const generateResultSchema = z.object({
  name: z.string().min(1),
  definition: workflowDefinitionSchema,
});

const NODE_CATALOG = WORKFLOW_NODE_META.map(
  (n) => `- ${n.kind}: ${n.label} (${n.category})`,
).join('\n');

const SYSTEM_PROMPT = `You design executable workflow DAGs for a general-purpose agent automation platform.
Return strict JSON only: {"name":"...","definition":{"nodes":[...],"edges":[...]}}.

Node kinds (use exactly these kind strings):
${NODE_CATALOG}

Rules:
- Every workflow MUST have exactly one "start" node and at least one "end" node.
- Connect nodes with edges; use label "true"/"false" only from if_else handles.
- Use label "error" only from code/http_request fail branches when needed.
- Node ids must be unique short strings (n1, n2, ...).
- Edge ids: e1, e2, ...
- Position nodes in a left-to-right layout (x increases ~160 per step, y varies for branches).
- Prefer practical automations: document retrieval, knowledge search, agent prompts, HTTP integrations, table read/write.
- run_agent.data: { "prompt": "...", "agentId": "${DEFAULT_AGENT_ID}" }
- knowledge_retrieval.data: { "query": "{{ ... }}" }
- table_read.data: { "sheetId": "main" }
- table_write.data: { "sheetId": "main", "rowKey": "...", "patch": {} }
- if_else.data: { "cases": [{ "caseId": "c1", "logicalOperator": "and", "conditions": [{ "left": "{{ n1.field }}", "operator": "contains", "right": "value" }] }] }
- end.data: { "outputs": [{ "name": "result", "value": "{{ lastNode.text }}" }] }
- Keep workflows practical: 3–8 nodes unless the user asks for more.`;

function layoutWorkflow(definition: WorkflowDefinition): WorkflowDefinition {
  const nodes = definition.nodes.map((node, index) => ({
    ...node,
    data: {
      label: WORKFLOW_NODE_META.find((m) => m.kind === node.kind)?.label ?? node.kind,
      ...node.data,
    },
    position: {
      x: 60 + (index % 4) * 170,
      y: 60 + Math.floor(index / 4) * 110,
    },
  }));
  return { nodes, edges: definition.edges };
}

function parseJsonContent(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) return JSON.parse(fence[1].trim());
  throw new Error('model did not return JSON');
}

export async function generateWorkflowFromPrompt(
  tenantId: string,
  prompt: string,
  current?: WorkflowDefinition,
): Promise<{ name: string; definition: WorkflowDefinition }> {
  await applyTenantModelSettings(tenantId);
  const cfg = getModelConfig(DEFAULT_MODEL);
  if (!cfg.apiKey) {
    throw new Error('Model API key is not configured; cannot generate workflow');
  }

  const userContent = current
    ? `Revise or extend this workflow based on the request.\n\nRequest:\n${prompt}\n\nCurrent definition:\n${JSON.stringify(current)}`
    : prompt;

  const res = await fetch(`${cfg.url.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.modelId,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      temperature: 0.2,
      max_tokens: 4000,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `LLM HTTP ${res.status}`);
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error('Model returned no content');

  const parsed = generateResultSchema.parse(parseJsonContent(raw));
  return {
    name: parsed.name.trim(),
    definition: layoutWorkflow(parsed.definition),
  };
}
