import { useCallback, useContext, useEffect, useMemo, useState, createContext, type ReactNode } from 'react';
import { Check, ChevronDown, Play, Plus, Save, ScrollText, Trash2 } from 'lucide-react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Node,
  type Edge,
  type NodeProps,
  Handle,
  Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { DEFAULT_AGENT_ID } from '@veylin/shared';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import type { PanelContentProps } from '../panel-types';
import { DismissibleBackdrop } from '@/components/ui/dismissible-backdrop';
import { cn } from '@/lib/utils';
import { useOverlayDismiss } from '@/lib/overlay-dismiss';
import { WorkflowRunPanel } from './workflow-run-panel';
import { WorkflowJsonBlock } from './workflow-json-block';
import { SettingsDeleteDialog } from '@/components/features/settings/settings-item-actions';
import {
  buildNodeRunStatusMap,
  nextSequentialNodeId,
  nodeDisplayLabel,
  suggestedVarRefs,
  upstreamNodeIds,
  type NodeRunStatus,
  type WorkflowRunView,
} from './workflow-run-utils';

type NodeKind =
  | 'start'
  | 'if_else'
  | 'set'
  | 'template'
  | 'code'
  | 'http_request'
  | 'knowledge_retrieval'
  | 'run_agent'
  | 'table_read'
  | 'table_write'
  | 'end';

type Category = 'trigger' | 'logic' | 'transform' | 'integration' | 'ai' | 'data' | 'output';

const NODE_META: Record<NodeKind, { label: string; category: Category; color: string }> = {
  start: { label: 'wf.node.start', category: 'trigger', color: '#16a34a' },
  if_else: { label: 'wf.node.if_else', category: 'logic', color: '#d97706' },
  set: { label: 'wf.node.set', category: 'transform', color: '#0891b2' },
  template: { label: 'wf.node.template', category: 'transform', color: '#0891b2' },
  code: { label: 'wf.node.code', category: 'transform', color: '#0891b2' },
  http_request: { label: 'wf.node.http_request', category: 'integration', color: '#7c3aed' },
  knowledge_retrieval: { label: 'wf.node.knowledge_retrieval', category: 'ai', color: '#db2777' },
  run_agent: { label: 'wf.node.run_agent', category: 'ai', color: '#db2777' },
  table_read: { label: 'wf.node.table_read', category: 'data', color: '#2563eb' },
  table_write: { label: 'wf.node.table_write', category: 'data', color: '#2563eb' },
  end: { label: 'wf.node.end', category: 'output', color: '#475569' },
};

const CATEGORY_LABELS: Record<Category, string> = {
  trigger: 'wf.cat.trigger',
  logic: 'wf.cat.logic',
  transform: 'wf.cat.transform',
  integration: 'wf.cat.integration',
  ai: 'wf.cat.ai',
  data: 'wf.cat.data',
  output: 'wf.cat.output',
};

const PALETTE_ORDER: Category[] = ['trigger', 'logic', 'transform', 'integration', 'ai', 'data', 'output'];

const OPERATORS: Array<{ id: string; label: string }> = [
  { id: 'is', label: 'wf.op.is' },
  { id: 'is_not', label: 'wf.op.is_not' },
  { id: 'contains', label: 'wf.op.contains' },
  { id: 'not_contains', label: 'wf.op.not_contains' },
  { id: 'starts_with', label: 'wf.op.starts_with' },
  { id: 'ends_with', label: 'wf.op.ends_with' },
  { id: 'is_empty', label: 'wf.op.is_empty' },
  { id: 'is_not_empty', label: 'wf.op.is_not_empty' },
  { id: 'in', label: 'wf.op.in' },
  { id: 'not_in', label: 'wf.op.not_in' },
  { id: 'eq', label: 'wf.op.eq' },
  { id: 'neq', label: 'wf.op.neq' },
  { id: 'gt', label: 'wf.op.gt' },
  { id: 'lt', label: 'wf.op.lt' },
  { id: 'gte', label: 'wf.op.gte' },
  { id: 'lte', label: 'wf.op.lte' },
  { id: 'is_null', label: 'wf.op.is_null' },
  { id: 'is_not_null', label: 'wf.op.is_not_null' },
];

type Condition = { left: string; operator: string; right: string };
type Field = { name: string; value: string };

type WorkflowSummary = { id: string; name: string; kind: string; enabled: boolean };

type WorkflowDetail = WorkflowSummary & {
  cron?: string | null;
  timezone?: string | null;
  definition: {
    nodes: Array<{ id: string; kind: NodeKind; position: { x: number; y: number }; data: Record<string, unknown> }>;
    edges: Array<{ id: string; source: string; target: string; label?: string }>;
  };
};

type NodeViewData = { label: string; kind: NodeKind };

const EMPTY_RUN_STATUS_MAP = new Map<string, NodeRunStatus>();
const WorkflowNodeRunStatusContext = createContext<Map<string, NodeRunStatus>>(EMPTY_RUN_STATUS_MAP);

function defaultData(kind: NodeKind): Record<string, unknown> {
  switch (kind) {
    case 'if_else':
      return { cases: [{ caseId: 'c1', logicalOperator: 'and', conditions: [{ left: '', operator: 'is', right: '' }] }] };
    case 'set':
      return { fields: [{ name: 'value', value: '' }] };
    case 'template':
      return { template: '' };
    case 'code':
      return { code: 'return { result: inputs };', inputs: [] };
    case 'http_request':
      return { method: 'GET', url: '', headers: '', body: '', auth: { type: 'none' }, errorStrategy: 'abort' };
    case 'knowledge_retrieval':
      return { query: '' };
    case 'run_agent':
      return { prompt: '', agentId: DEFAULT_AGENT_ID };
    case 'table_read':
      return { sheetId: 'main' };
    case 'table_write':
      return { sheetId: 'main', rowKey: '', patch: {} };
    case 'end':
      return { outputs: [] };
    default:
      return {};
  }
}

function NodeView({ id, data }: NodeProps) {
  const d = data as NodeViewData;
  const runStatus = useContext(WorkflowNodeRunStatusContext).get(id);
  const meta = NODE_META[d.kind];
  const isStart = d.kind === 'start';
  const isEnd = d.kind === 'end';
  const isBranch = d.kind === 'if_else';
  const hasFail = d.kind === 'code' || d.kind === 'http_request';
  const runRing =
    runStatus === 'ok'
      ? 'ring-2 ring-green-500/50'
      : runStatus === 'error'
        ? 'ring-2 ring-red-500/50'
        : runStatus === 'running'
          ? 'ring-2 ring-amber-500/50 animate-pulse'
          : '';
  return (
    <div
      className={cn('bg-background rounded border px-2 py-1 text-xs shadow-sm', runRing)}
      style={{ borderLeft: `3px solid ${meta.color}`, minWidth: 96 }}
    >
      {!isStart ? <Handle type="target" position={Position.Left} className="!bg-muted-foreground" /> : null}
      <div className="text-muted-foreground text-[10px]">{i18n.t(meta.label)}</div>
      <div className="font-medium">{d.label}</div>
      <div className="text-muted-foreground font-mono text-[9px]">{id}</div>
      {isBranch ? (
        <>
          <Handle id="true" type="source" position={Position.Right} style={{ top: '35%' }} className="!bg-green-500" />
          <Handle id="false" type="source" position={Position.Right} style={{ top: '70%' }} className="!bg-red-500" />
        </>
      ) : hasFail ? (
        <>
          <Handle id="success" type="source" position={Position.Right} style={{ top: '35%' }} className="!bg-muted-foreground" />
          <Handle id="error" type="source" position={Position.Right} style={{ top: '70%' }} className="!bg-red-500" />
        </>
      ) : !isEnd ? (
        <Handle type="source" position={Position.Right} className="!bg-muted-foreground" />
      ) : null}
    </div>
  );
}

const nodeTypes = { wf: NodeView };

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let message = text;
    try {
      const json = JSON.parse(text) as { message?: string };
      if (json.message) message = json.message;
    } catch {
      /* keep raw */
    }
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      throw new Error(i18n.t('wf.backendUnavailable', { status: res.status }));
    }
    throw new Error(message || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>, attempts: number): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) await sleep(400 * (i + 1));
    }
  }
  throw lastError;
}

function toFlowNodes(def: WorkflowDetail['definition']): Node[] {
  return def.nodes.map((n) => ({
    id: n.id,
    type: 'wf',
    position: n.position,
    data: {
      kind: n.kind,
      label: String(n.data.label ?? (NODE_META[n.kind] ? i18n.t(NODE_META[n.kind].label) : n.id.slice(0, 6))),
      ...n.data,
    },
  }));
}

function toFlowEdges(def: WorkflowDetail['definition']): Edge[] {
  return def.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.label && e.label !== 'source' ? e.label : undefined,
    label: e.label && e.label !== 'source' ? e.label : undefined,
  }));
}

function fromFlowState(nodes: Node[], edges: Edge[]): WorkflowDetail['definition'] {
  return {
    nodes: nodes.map((n) => {
      const data = { ...(n.data as Record<string, unknown>) };
      const kind = data.kind as NodeKind;
      delete data.kind;
      delete data.runStatus;
      return { id: n.id, kind, position: n.position, data };
    }),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      ...(e.sourceHandle ? { label: e.sourceHandle } : {}),
    })),
  };
}

function workflowNameTaken(
  name: string,
  workflows: WorkflowSummary[],
  excludeId?: string,
): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  return workflows.some((w) => w.name.trim() === trimmed && w.id !== excludeId);
}

function uniqueWorkflowName(workflows: WorkflowSummary[], preferred: string): string {
  const taken = new Set(workflows.map((w) => w.name.trim()));
  const trimmed = preferred.trim() || i18n.t('wf.newFlow');
  if (!taken.has(trimmed)) return trimmed;
  const base = trimmed.replace(/\s+\d+$/, '') || i18n.t('wf.newFlow');
  let n = 1;
  while (taken.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

export function WorkflowPanel({ tab, updateState }: PanelContentProps) {
  const workflowId = tab.state?.workflowId as string | undefined;
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [workflow, setWorkflow] = useState<WorkflowDetail | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(true);
  const [runs, setRuns] = useState<WorkflowRunView[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedLogNodeId, setSelectedLogNodeId] = useState<string | null>(null);
  const [pollFast, setPollFast] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation();
  const [name, setName] = useState(() => i18n.t('wf.newFlow'));
  const [isNewDraft, setIsNewDraft] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [workflowMenuOpen, setWorkflowMenuOpen] = useState(false);
  const closeWorkflowMenu = useCallback(() => setWorkflowMenuOpen(false), []);
  useOverlayDismiss(closeWorkflowMenu);
  const [deletePrompt, setDeletePrompt] = useState<
    | { type: 'workflow'; id: string; name: string }
    | { type: 'draft'; name: string }
    | null
  >(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const editingWorkflowId = isNewDraft ? undefined : (workflow?.id ?? workflowId);

  const startNewWorkflow = useCallback((existing?: WorkflowSummary[]) => {
    const list = existing ?? workflows;
    setIsNewDraft(true);
    setWorkflow(null);
    setNodes([
      {
        id: 'n1',
        type: 'wf',
        position: { x: 80, y: 120 },
        data: { kind: 'start', label: i18n.t(NODE_META.start.label), ...defaultData('start') },
      },
    ]);
    setEdges([]);
    setName(uniqueWorkflowName(list, `${i18n.t('wf.newFlow')} ${list.length + 1}`));
    setSelectedId(null);
    setShowLogs(true);
    setRuns([]);
    setSelectedRunId(null);
    setSelectedLogNodeId(null);
    setError(null);
    updateState({ workflowId: undefined });
  }, [setNodes, setEdges, updateState, workflows]);

  const selectedNode = useMemo(() => nodes.find((n) => n.id === selectedId) ?? null, [nodes, selectedId]);
  const selKind = selectedNode ? ((selectedNode.data as { kind: NodeKind }).kind) : null;

  async function loadWorkflowList(attempts = 1): Promise<WorkflowSummary[]> {
    const data = await withRetry(
      () => fetchJson<{ workflows: WorkflowSummary[] }>('/api/workflows'),
      attempts,
    );
    const list = data.workflows ?? [];
    setWorkflows(list);
    return list;
  }

  async function loadWorkflow(id: string, attempts = 1) {
    const data = await withRetry(
      () => fetchJson<{ workflow: WorkflowDetail }>(`/api/workflows/${id}`),
      attempts,
    );
    const wf = data.workflow;
    setWorkflow(wf);
    setName(wf.name);
    setNodes(toFlowNodes(wf.definition));
    setEdges(toFlowEdges(wf.definition));
    setIsNewDraft(false);
    updateState({ workflowId: id });
    void loadRuns(id).catch(() => undefined);
  }

  async function loadRuns(id: string, pickLatest = false) {
    const data = await fetchJson<{ runs: WorkflowRunView[] }>(`/api/workflows/${id}/runs`);
    const list = data.runs ?? [];
    setRuns(list);
    if (list.length === 0) {
      setSelectedRunId(null);
      return list;
    }
    if (pickLatest) {
      setSelectedRunId(list[0]!.id);
    } else {
      setSelectedRunId((current) => {
        if (!current || !list.some((r) => r.id === current)) return list[0]!.id;
        return current;
      });
    }
    const active = list.some((r) => r.status === 'running' || r.status === 'queued');
    setPollFast(active);
    return list;
  }

  const selectedRun = useMemo(
    () => runs.find((r) => r.id === selectedRunId) ?? runs[0] ?? null,
    [runs, selectedRunId],
  );

  const runTraceKey = selectedRun
    ? `${selectedRun.id}:${selectedRun.status}:${selectedRun.log.map((e) => `${e.nodeId}:${e.status}`).join('|')}`
    : '';

  const nodeIdsKey = useMemo(() => nodes.map((n) => n.id).join(','), [nodes]);

  const nodeRunStatusMap = useMemo(() => {
    if (!selectedRun) return EMPTY_RUN_STATUS_MAP;
    return buildNodeRunStatusMap(
      selectedRun,
      nodes.map((n) => n.id),
    );
  }, [selectedRun, runTraceKey, nodeIdsKey, nodes]);

  const nodeLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of nodes) {
      map.set(n.id, String((n.data as { label?: string }).label ?? ''));
    }
    return map;
  }, [nodes]);

  useEffect(() => {
    void loadWorkflowList(6).catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
    });
  }, []);

  useEffect(() => {
    if (workflowId) return;
    if (nodes.length > 0) return;
    if (error) return;
    startNewWorkflow();
  }, [workflowId, nodes.length, startNewWorkflow, error]);

  useEffect(() => {
    if (!workflowId) return;
    void loadWorkflow(workflowId, 6).catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
    });
  }, [workflowId]);

  useEffect(() => {
    if (!workflowId) return;
    const hasActiveRun = runs.some((r) => r.status === 'running' || r.status === 'queued');
    if (!showLogs && !hasActiveRun) return;
    const poll = () => loadRuns(workflowId).catch(() => undefined);
    void poll();
    const ms = hasActiveRun ? (pollFast ? 1200 : 2500) : 15000;
    const timer = setInterval(() => void poll(), ms);
    return () => clearInterval(timer);
  }, [workflowId, showLogs, pollFast, runs]);

  const onConnect = useCallback(
    (connection: Connection) =>
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            label: connection.sourceHandle ?? undefined,
          },
          eds,
        ),
      ),
    [setEdges],
  );

  function addNode(kind: NodeKind) {
    const id = nextSequentialNodeId(nodes.map((n) => n.id));
    setNodes((nds) => [
      ...nds,
      {
        id,
        type: 'wf',
        position: { x: 60 + (nds.length % 4) * 150, y: 60 + Math.floor(nds.length / 4) * 90 },
        data: { kind, label: i18n.t(NODE_META[kind].label), ...defaultData(kind) },
      },
    ]);
    setPaletteOpen(false);
  }

  async function saveWorkflow(): Promise<string | undefined> {
    const trimmedName = name.trim() || i18n.t('wf.untitledFlow');
    if (workflowNameTaken(trimmedName, workflows, editingWorkflowId)) {
      setError(t('wf.nameExists', { name: trimmedName }));
      return undefined;
    }
    setSaving(true);
    try {
      const definition = fromFlowState(nodes, edges);
      const body = {
        name: trimmedName,
        definition,
        kind: workflow?.kind ?? 'manual',
        enabled: workflow?.enabled ?? true,
        cron: workflow?.cron ?? undefined,
        timezone: workflow?.timezone ?? 'UTC',
      };
      if (editingWorkflowId) {
        const data = await fetchJson<{ workflow: WorkflowDetail }>(`/api/workflows/${editingWorkflowId}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        setWorkflow(data.workflow);
        setIsNewDraft(false);
        await loadWorkflowList();
        setError(null);
        return data.workflow.id;
      }
      const data = await fetchJson<{ workflow: WorkflowDetail }>('/api/workflows', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      setWorkflow(data.workflow);
      setIsNewDraft(false);
      updateState({ workflowId: data.workflow.id });
      await loadWorkflowList();
      setError(null);
      return data.workflow.id;
    } catch (err) {
      setError(String(err));
      return undefined;
    } finally {
      setSaving(false);
    }
  }

  async function runWorkflow() {
    let id = editingWorkflowId;
    if (!id) id = await saveWorkflow();
    if (!id) return;
    setRunning(true);
    try {
      await fetchJson(`/api/workflows/${id}/run`, { method: 'POST' });
      setShowLogs(true);
      setPollFast(true);
      await loadRuns(id, true);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setRunning(false);
    }
  }

  function patchSelected(patch: Record<string, unknown>) {
    if (!selectedId) return;
    setNodes((nds) => nds.map((n) => (n.id === selectedId ? { ...n, data: { ...n.data, ...patch } } : n)));
  }

  async function handleStartNewWorkflow() {
    setWorkflowMenuOpen(false);
    const savedId = await saveWorkflow();
    if (!savedId) return;
    const list = await loadWorkflowList();
    startNewWorkflow(list);
  }

  function discardDraft() {
    setWorkflowMenuOpen(false);
    setDeletePrompt({ type: 'draft', name: currentDraftLabel });
  }

  async function confirmWorkflowDelete() {
    if (!deletePrompt) return;
    setDeleteBusy(true);
    try {
      if (deletePrompt.type === 'draft') {
        if (workflows.length > 0) {
          await loadWorkflow(workflows[0]!.id);
        } else {
          startNewWorkflow([]);
        }
      } else {
        await fetchJson(`/api/workflows/${deletePrompt.id}`, { method: 'DELETE' });
        const list = await loadWorkflowList();
        if (editingWorkflowId === deletePrompt.id) {
          if (list.length > 0) {
            await loadWorkflow(list[0]!.id);
          } else {
            startNewWorkflow(list);
          }
        }
      }
      setDeletePrompt(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleteBusy(false);
    }
  }

  function requestDeleteWorkflow(id: string, workflowName: string) {
    setWorkflowMenuOpen(false);
    setDeletePrompt({ type: 'workflow', id, name: workflowName });
  }

  const workflowSwitcherLabel = isNewDraft
    ? name.trim() || t('wf.newDraft')
    : (workflow?.name ?? name);
  const currentDraftLabel = name.trim() || t('wf.newDraft');
  const nameConflict = useMemo(
    () => workflowNameTaken(name, workflows, editingWorkflowId),
    [name, workflows, editingWorkflowId],
  );

  const toolbarIconBtn =
    'bg-muted hover:bg-muted/80 inline-flex size-7 shrink-0 items-center justify-center rounded disabled:opacity-50';

  function selData<T = unknown>(key: string, fallback: T): T {
    return ((selectedNode?.data as Record<string, unknown>)?.[key] as T) ?? fallback;
  }

  return (
    <div className="flex h-full flex-col">
      {/* toolbar */}
      <div className="border-border relative z-20 flex flex-wrap items-center gap-1 border-b px-2 py-1.5">
        <div className="relative">
          <button
            type="button"
            className="bg-background border-border hover:bg-muted inline-flex max-w-[160px] items-center gap-1 rounded border px-2 py-1 text-xs"
            onClick={() => setWorkflowMenuOpen((v) => !v)}
          >
            <span className="truncate">{workflowSwitcherLabel}</span>
            <ChevronDown className="size-3.5 shrink-0 opacity-60" />
          </button>
          {workflowMenuOpen ? (
            <>
              <DismissibleBackdrop
                ariaLabel={t('wf.closeList')}
                onClose={closeWorkflowMenu}
                className="fixed inset-0 z-[200] cursor-default bg-black/20"
              />
              <div className="border-border bg-popover absolute left-0 top-full z-[201] mt-1 w-56 overflow-hidden rounded-md border shadow-lg">
                <div className="max-h-48 overflow-y-auto py-1">
                  {isNewDraft ? (
                    <div className="bg-muted flex items-center gap-0.5 pr-1">
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-1.5 px-2.5 py-1.5 text-left text-xs"
                        onClick={() => setWorkflowMenuOpen(false)}
                      >
                        <Check className="size-3.5 shrink-0" />
                        <span className="truncate">{currentDraftLabel}</span>
                      </button>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded p-1"
                        title={t('wf.discardDraft')}
                        data-no-window-drag
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          discardDraft();
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ) : null}
                  {workflows.length === 0 && !isNewDraft ? (
                    <p className="text-muted-foreground px-2.5 py-2 text-xs">{t('wf.noSavedFlows')}</p>
                  ) : (
                    workflows.map((w) => {
                      const active = !isNewDraft && editingWorkflowId === w.id;
                      return (
                        <div
                          key={w.id}
                          className={cn(
                            'flex items-center gap-0.5 pr-1',
                            active ? 'bg-muted' : 'hover:bg-muted/60',
                          )}
                        >
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 items-center gap-1.5 px-2.5 py-1.5 text-left text-xs"
                            onClick={() => {
                              setWorkflowMenuOpen(false);
                              void loadWorkflow(w.id).catch((err) => setError(String(err)));
                            }}
                          >
                            {active ? <Check className="size-3.5 shrink-0" /> : <span className="size-3.5 shrink-0" />}
                            <span className="truncate">{w.name}</span>
                          </button>
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded p-1"
                            title={t('wf.delete')}
                            data-no-window-drag
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              requestDeleteWorkflow(w.id, w.name);
                            }}
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
                <div className="border-border border-t p-1">
                  <button
                    type="button"
                    className="hover:bg-muted flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs"
                    onClick={() => void handleStartNewWorkflow()}
                  >
                    <Plus className="size-3.5" />
                    {t('wf.new')}
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </div>
        <input
          className={cn(
            'bg-background border-border min-w-[90px] flex-1 rounded border px-2 py-1 text-xs',
            nameConflict && 'border-destructive',
          )}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError(null);
          }}
          placeholder={t('wf.flowNamePlaceholder')}
        />
        <div className="relative">
          <button
            type="button"
            className="bg-muted hover:bg-muted/80 inline-flex h-7 shrink-0 items-center gap-1 rounded px-2 text-xs"
            onClick={() => setPaletteOpen((v) => !v)}
          >
            <Plus className="size-3.5" />
            {t('wf.nodes')}
          </button>
          {paletteOpen ? (
            <div className="border-border bg-popover absolute right-0 z-10 mt-1 w-44 rounded border p-1 shadow-md">
              {PALETTE_ORDER.map((cat) => {
                const kinds = (Object.keys(NODE_META) as NodeKind[]).filter((k) => NODE_META[k].category === cat);
                return (
                  <div key={cat} className="mb-1">
                    <div className="text-muted-foreground px-1 py-0.5 text-[10px] uppercase">{t(CATEGORY_LABELS[cat])}</div>
                    {kinds.map((k) => (
                      <button
                        key={k}
                        type="button"
                        className="hover:bg-muted flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs"
                        onClick={() => addNode(k)}
                      >
                        <span className="inline-block size-2 rounded-full" style={{ background: NODE_META[k].color }} />
                        {t(NODE_META[k].label)}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className={toolbarIconBtn}
          disabled={saving || nameConflict}
          title={isNewDraft ? t('wf.saveAsNew') : t('wf.save')}
          onClick={() => void saveWorkflow()}
        >
          {saving ? <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Save className="size-3.5" />}
        </button>
        <button
          type="button"
          className={toolbarIconBtn}
          disabled={running}
          title={t('wf.run')}
          onClick={() => void runWorkflow()}
        >
          {running ? <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Play className="size-3.5" />}
        </button>
        <button
          type="button"
          className={cn(
            toolbarIconBtn,
            showLogs && 'bg-foreground text-background hover:bg-foreground/90',
          )}
          title={t('wf.runLogs')}
          onClick={() => setShowLogs((v) => !v)}
        >
          <ScrollText className="size-3.5" />
        </button>
      </div>

      {error || nameConflict ? (
        <div className="text-destructive px-3 py-1 text-xs">
          {nameConflict ? t('wf.nameExists', { name: name.trim() }) : error}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1">
          <WorkflowNodeRunStatusContext.Provider value={nodeRunStatusMap}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              nodeTypes={nodeTypes}
              fitView
              proOptions={{ hideAttribution: true }}
              onNodeClick={(_, node) => {
                setSelectedId(node.id);
                if (selectedRun?.log.some((e) => e.nodeId === node.id)) {
                  setSelectedLogNodeId(node.id);
                }
              }}
              onPaneClick={() => setSelectedId(null)}
            >
              <Background />
              <Controls />
              <MiniMap pannable zoomable />
            </ReactFlow>
          </WorkflowNodeRunStatusContext.Provider>
        </div>

        {selectedNode && selKind ? (
          <div className="border-border w-64 shrink-0 overflow-auto border-l p-2 text-xs">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-medium">{t(NODE_META[selKind].label)}</span>
              <button
                type="button"
                className="text-destructive text-[11px]"
                onClick={() => {
                  setNodes((nds) => nds.filter((n) => n.id !== selectedId));
                  setEdges((eds) => eds.filter((e) => e.source !== selectedId && e.target !== selectedId));
                  setSelectedId(null);
                }}
              >
                {t('wf.delete')}
              </button>
            </div>

            <p className="text-muted-foreground mb-2 font-mono text-[10px]">ID: {selectedId}</p>

            <label className="mb-2 block">
              <span className="text-muted-foreground">{t('wf.label')}</span>
              <input
                className="bg-background border-border mt-0.5 w-full rounded border px-1.5 py-1"
                value={selData('label', '')}
                onChange={(e) => patchSelected({ label: e.target.value })}
              />
            </label>

            {selectedRun && selectedId ? (
              <NodeLastRun
                run={selectedRun}
                nodeId={selectedId}
                nodeLabel={nodeDisplayLabel(selectedId, nodeLabels.get(selectedId))}
              />
            ) : null}

            <NodeForm
              kind={selKind}
              nodeId={selectedId!}
              selData={selData}
              patchSelected={patchSelected}
              nodes={nodes}
              edges={edges}
              selectedRun={selectedRun}
            />
          </div>
        ) : null}
      </div>

      {showLogs ? (
        <WorkflowRunPanel
          runs={runs}
          selectedRunId={selectedRunId}
          onSelectRun={setSelectedRunId}
          selectedLogNodeId={selectedLogNodeId}
          onSelectLogNode={(nodeId) => {
            setSelectedLogNodeId(nodeId);
            if (nodeId) setSelectedId(nodeId);
          }}
          nodeLabels={nodeLabels}
        />
      ) : null}

      <SettingsDeleteDialog
        open={deletePrompt !== null}
        onOpenChange={(open) => !open && !deleteBusy && setDeletePrompt(null)}
        title={deletePrompt?.type === 'draft' ? t('wf.discardDraft') : t('wf.delete')}
        description={
          deletePrompt?.type === 'draft'
            ? t('wf.confirmDiscard', { name: deletePrompt.name })
            : deletePrompt
              ? t('wf.confirmDelete', { name: deletePrompt.name })
              : ''
        }
        onConfirm={() => void confirmWorkflowDelete()}
        busy={deleteBusy}
      />
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-2 block">
      <span className="text-muted-foreground">{label}</span>
      <div className="mt-0.5">{children}</div>
    </label>
  );
}

const inputCls = 'bg-background border-border w-full rounded border px-1.5 py-1';

function NodeLastRun({
  run,
  nodeId,
  nodeLabel,
}: {
  run: WorkflowRunView;
  nodeId: string;
  nodeLabel: string;
}) {
  const { t } = useTranslation();
  const entry = run.log.find((e) => e.nodeId === nodeId);
  if (!entry) {
    return (
      <div className="border-border mb-3 rounded border p-2">
        <p className="text-muted-foreground text-[10px] font-medium">{t('wf.run.lastRun')}</p>
        <p className="text-muted-foreground mt-1 text-[11px]">{t('wf.run.notExecuted')}</p>
      </div>
    );
  }
  return (
    <div className="border-border mb-3 rounded border p-2">
      <p className="text-muted-foreground mb-1 text-[10px] font-medium">{t('wf.run.lastRun')}</p>
      <p className="mb-1 text-[11px]">
        <span className={entry.status === 'ok' ? 'text-green-600' : 'text-destructive'}>
          [{entry.status}]
        </span>{' '}
        {nodeLabel}
      </p>
      <WorkflowJsonBlock value={entry.output} maxHeight="max-h-28" />
    </div>
  );
}

function UpstreamVarPicker({
  targetNodeId,
  nodes,
  edges,
  selectedRun,
  onInsert,
}: {
  targetNodeId: string;
  nodes: Node[];
  edges: Edge[];
  selectedRun: WorkflowRunView | null;
  onInsert: (ref: string) => void;
}) {
  const { t } = useTranslation();
  const upstream = upstreamNodeIds(targetNodeId, edges);
  if (upstream.length === 0) return null;

  return (
    <div className="border-border mb-2 rounded border p-1.5">
      <div className="text-muted-foreground mb-1 text-[10px]">{t('wf.run.insertVar')}</div>
      {upstream.map((id) => {
        const node = nodes.find((n) => n.id === id);
        const kind = String((node?.data as { kind?: NodeKind })?.kind ?? '');
        const label = nodeDisplayLabel(id, String((node?.data as { label?: string })?.label ?? ''));
        const logEntry = selectedRun?.log.find((e) => e.nodeId === id && e.status === 'ok');
        const refs = suggestedVarRefs(id, kind, logEntry?.output);
        return (
          <div key={id} className="mb-1.5">
            <div className="text-[10px] font-medium">{label}</div>
            <div className="flex flex-wrap gap-0.5">
              {refs.slice(0, 8).map((ref) => (
                <button
                  key={ref}
                  type="button"
                  className="bg-muted hover:bg-muted/80 rounded px-1 py-0.5 font-mono text-[9px]"
                  onClick={() => onInsert(ref)}
                >
                  {ref}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function NodeForm({
  kind,
  nodeId,
  selData,
  patchSelected,
  nodes,
  edges,
  selectedRun,
}: {
  kind: NodeKind;
  nodeId: string;
  selData: <T>(key: string, fallback: T) => T;
  patchSelected: (patch: Record<string, unknown>) => void;
  nodes: Node[];
  edges: Edge[];
  selectedRun: WorkflowRunView | null;
}) {
  const { t } = useTranslation();

  function renderVarPicker(onInsert: (ref: string) => void) {
    return (
      <UpstreamVarPicker
        targetNodeId={nodeId}
        nodes={nodes}
        edges={edges}
        selectedRun={selectedRun}
        onInsert={onInsert}
      />
    );
  }

  function appendVar(field: string, ref: string) {
    const current = String(selData(field, '') ?? '');
    patchSelected({ [field]: current ? `${current} ${ref}` : ref });
  }

  switch (kind) {
    case 'start':
      return (
        <p className="text-muted-foreground text-[11px]">
          {t('wf.form.startHint', { ref: `{{ ${nodeId}.field }}` })}
        </p>
      );

    case 'if_else': {
      const cases = selData<Array<{ caseId: string; logicalOperator: string; conditions: Condition[] }>>('cases', []);
      const c = cases[0] ?? { caseId: 'c1', logicalOperator: 'and', conditions: [] };
      const update = (conds: Condition[], logical = c.logicalOperator) =>
        patchSelected({ cases: [{ ...c, logicalOperator: logical, conditions: conds }] });
      return (
        <>
          {renderVarPicker((ref) => {
            const next = [...c.conditions];
            const idx = Math.max(0, next.length - 1);
            const cond = next[idx] ?? { left: '', operator: 'is', right: '' };
            next[idx] = { ...cond, left: cond.left ? `${cond.left} ${ref}` : ref };
            update(next);
          })}
          <Labeled label={t('wf.form.conditionCombo')}>
            <select className={inputCls} value={c.logicalOperator} onChange={(e) => update(c.conditions, e.target.value)}>
              <option value="and">{t('wf.form.matchAll')}</option>
              <option value="or">{t('wf.form.matchAny')}</option>
            </select>
          </Labeled>
          {c.conditions.map((cond, i) => (
            <div key={i} className="border-border mb-2 rounded border p-1.5">
              <input
                className={`${inputCls} mb-1`}
                placeholder={t('wf.form.leftPlaceholder')}
                value={cond.left}
                onChange={(e) => {
                  const next = [...c.conditions];
                  next[i] = { ...cond, left: e.target.value };
                  update(next);
                }}
              />
              <select
                className={`${inputCls} mb-1`}
                value={cond.operator}
                onChange={(e) => {
                  const next = [...c.conditions];
                  next[i] = { ...cond, operator: e.target.value };
                  update(next);
                }}
              >
                {OPERATORS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {t(o.label)}
                  </option>
                ))}
              </select>
              <input
                className={inputCls}
                placeholder={t('wf.form.rightPlaceholder')}
                value={cond.right}
                onChange={(e) => {
                  const next = [...c.conditions];
                  next[i] = { ...cond, right: e.target.value };
                  update(next);
                }}
              />
              <button
                type="button"
                className="text-destructive mt-1 text-[11px]"
                onClick={() => update(c.conditions.filter((_, j) => j !== i))}
              >
                {t('wf.form.removeCondition')}
              </button>
            </div>
          ))}
          <button
            type="button"
            className="bg-muted rounded px-2 py-1 text-[11px]"
            onClick={() => update([...c.conditions, { left: '', operator: 'is', right: '' }])}
          >
            {t('wf.form.addCondition')}
          </button>
          <p className="text-muted-foreground mt-2 text-[10px]">{t('wf.form.branchHint')}</p>
        </>
      );
    }

    case 'set':
    case 'end': {
      const key = kind === 'set' ? 'fields' : 'outputs';
      const fields = selData<Field[]>(key, []);
      const update = (next: Field[]) => patchSelected({ [key]: next });
      return (
        <>
          {renderVarPicker((ref) => {
            if (fields.length === 0) {
              update([{ name: 'result', value: ref }]);
              return;
            }
            const i = fields.length - 1;
            const row = fields[i]!;
            const next = [...fields];
            next[i] = { ...row, value: row.value ? `${row.value} ${ref}` : ref };
            update(next);
          })}
          {fields.map((f, i) => (
            <div key={i} className="border-border mb-2 rounded border p-1.5">
              <input
                className={`${inputCls} mb-1`}
                placeholder={t('wf.form.fieldName')}
                value={f.name}
                onChange={(e) => {
                  const next = [...fields];
                  next[i] = { ...f, name: e.target.value };
                  update(next);
                }}
              />
              <input
                className={inputCls}
                placeholder={t('wf.form.valuePlaceholder')}
                value={f.value}
                onChange={(e) => {
                  const next = [...fields];
                  next[i] = { ...f, value: e.target.value };
                  update(next);
                }}
              />
              <button type="button" className="text-destructive mt-1 text-[11px]" onClick={() => update(fields.filter((_, j) => j !== i))}>
                {t('wf.form.remove')}
              </button>
            </div>
          ))}
          <button type="button" className="bg-muted rounded px-2 py-1 text-[11px]" onClick={() => update([...fields, { name: '', value: '' }])}>
            {t('wf.form.addField')}
          </button>
          {kind === 'end' ? <p className="text-muted-foreground mt-2 text-[10px]">{t('wf.form.endHint')}</p> : null}
        </>
      );
    }

    case 'template':
      return (
        <>
          {renderVarPicker((ref) => appendVar('template', ref))}
          <Labeled label={t('wf.form.templateLabel')}>
            <textarea className={inputCls} rows={5} value={selData('template', '')} onChange={(e) => patchSelected({ template: e.target.value })} />
          </Labeled>
        </>
      );

    case 'code': {
      const inputs = selData<Field[]>('inputs', []);
      const update = (next: Field[]) => patchSelected({ inputs: next });
      return (
        <>
          <p className="text-muted-foreground mb-1 text-[10px]">{t('wf.form.codeHint')}</p>
          {inputs.map((f, i) => (
            <div key={i} className="mb-1 flex gap-1">
              <input
                className={inputCls}
                placeholder={t('wf.form.varName')}
                value={f.name}
                onChange={(e) => {
                  const next = [...inputs];
                  next[i] = { ...f, name: e.target.value };
                  update(next);
                }}
              />
              <input
                className={inputCls}
                placeholder="{{ nodeId.field }}"
                value={f.value}
                onChange={(e) => {
                  const next = [...inputs];
                  next[i] = { ...f, value: e.target.value };
                  update(next);
                }}
              />
            </div>
          ))}
          <button type="button" className="bg-muted mb-2 rounded px-2 py-1 text-[11px]" onClick={() => update([...inputs, { name: '', value: '' }])}>
            {t('wf.form.addInputVar')}
          </button>
          <Labeled label={t('wf.form.code')}>
            <textarea className={`${inputCls} font-mono`} rows={6} value={selData('code', '')} onChange={(e) => patchSelected({ code: e.target.value })} />
          </Labeled>
          <FailStrategy selData={selData} patchSelected={patchSelected} />
        </>
      );
    }

    case 'http_request':
      return (
        <>
          <Labeled label={t('wf.form.method')}>
            <select className={inputCls} value={selData('method', 'GET')} onChange={(e) => patchSelected({ method: e.target.value })}>
              {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Labeled>
          <Labeled label="URL">
            <input className={inputCls} placeholder={t('wf.form.urlPlaceholder')} value={selData('url', '')} onChange={(e) => patchSelected({ url: e.target.value })} />
          </Labeled>
          <Labeled label={t('wf.form.headers')}>
            <textarea className={inputCls} rows={2} value={selData('headers', '')} onChange={(e) => patchSelected({ headers: e.target.value })} />
          </Labeled>
          <Labeled label={t('wf.form.body')}>
            <textarea className={inputCls} rows={3} value={selData('body', '')} onChange={(e) => patchSelected({ body: e.target.value })} />
          </Labeled>
          <Labeled label={t('wf.form.auth')}>
            <select
              className={inputCls}
              value={(selData<{ type?: string }>('auth', { type: 'none' }).type) ?? 'none'}
              onChange={(e) => patchSelected({ auth: { ...selData('auth', {}), type: e.target.value } })}
            >
              <option value="none">{t('wf.form.authNone')}</option>
              <option value="bearer">Bearer Token</option>
              <option value="apiKey">API Key Header</option>
            </select>
          </Labeled>
          {selData<{ type?: string }>('auth', {}).type === 'bearer' ? (
            <Labeled label="Token">
              <input
                className={inputCls}
                value={selData<{ token?: string }>('auth', {}).token ?? ''}
                onChange={(e) => patchSelected({ auth: { ...selData('auth', {}), type: 'bearer', token: e.target.value } })}
              />
            </Labeled>
          ) : null}
          {selData<{ type?: string }>('auth', {}).type === 'apiKey' ? (
            <>
              <Labeled label={t('wf.form.headerName')}>
                <input
                  className={inputCls}
                  placeholder="X-API-Key"
                  value={selData<{ header?: string }>('auth', {}).header ?? ''}
                  onChange={(e) => patchSelected({ auth: { ...selData('auth', {}), type: 'apiKey', header: e.target.value } })}
                />
              </Labeled>
              <Labeled label="API Key">
                <input
                  className={inputCls}
                  value={selData<{ apiKey?: string }>('auth', {}).apiKey ?? ''}
                  onChange={(e) => patchSelected({ auth: { ...selData('auth', {}), type: 'apiKey', apiKey: e.target.value } })}
                />
              </Labeled>
            </>
          ) : null}
          <FailStrategy selData={selData} patchSelected={patchSelected} />
        </>
      );

    case 'knowledge_retrieval':
      return (
        <>
          {renderVarPicker((ref) => appendVar('query', ref))}
          <Labeled label={t('wf.form.query')}>
            <textarea className={inputCls} rows={3} value={selData('query', '')} onChange={(e) => patchSelected({ query: e.target.value })} />
          </Labeled>
        </>
      );

    case 'run_agent':
      return (
        <>
          {renderVarPicker((ref) => appendVar('prompt', ref))}
          <Labeled label="Agent ID">
            <input className={inputCls} value={selData('agentId', DEFAULT_AGENT_ID)} onChange={(e) => patchSelected({ agentId: e.target.value })} />
          </Labeled>
          <Labeled label={t('wf.form.prompt')}>
            <textarea className={inputCls} rows={5} value={selData('prompt', '')} onChange={(e) => patchSelected({ prompt: e.target.value })} />
          </Labeled>
        </>
      );

    case 'table_read':
      return (
        <Labeled label="Sheet ID">
          <input className={inputCls} value={selData('sheetId', 'main')} onChange={(e) => patchSelected({ sheetId: e.target.value })} />
        </Labeled>
      );

    case 'table_write': {
      const patch = selData<Record<string, string>>('patch', {});
      const patchJson = JSON.stringify(patch, null, 0);
      return (
        <>
          <Labeled label="Sheet ID">
            <input className={inputCls} value={selData('sheetId', 'main')} onChange={(e) => patchSelected({ sheetId: e.target.value })} />
          </Labeled>
          <Labeled label={t('wf.form.rowKey')}>
            <input className={inputCls} value={selData('rowKey', '')} onChange={(e) => patchSelected({ rowKey: e.target.value })} />
          </Labeled>
          <Labeled label={t('wf.form.updateContent')}>
            <textarea
              className={inputCls}
              rows={3}
              defaultValue={patchJson === '{}' ? '' : patchJson}
              onBlur={(e) => {
                try {
                  patchSelected({ patch: e.target.value.trim() ? JSON.parse(e.target.value) : {} });
                } catch {
                  /* ignore invalid json until valid */
                }
              }}
            />
          </Labeled>
        </>
      );
    }

    default:
      return null;
  }
}

function FailStrategy({
  selData,
  patchSelected,
}: {
  selData: <T>(key: string, fallback: T) => T;
  patchSelected: (patch: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  return (
    <Labeled label={t('wf.form.errorHandling')}>
      <select className={inputCls} value={selData('errorStrategy', 'abort')} onChange={(e) => patchSelected({ errorStrategy: e.target.value })}>
        <option value="abort">{t('wf.form.errorAbort')}</option>
        <option value="fail-branch">{t('wf.form.errorBranch')}</option>
      </select>
    </Labeled>
  );
}
