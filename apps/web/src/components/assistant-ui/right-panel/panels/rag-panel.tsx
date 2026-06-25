import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d';
import {
  BookOpen,
  CheckCircle2,
  CircleAlert,
  Copy,
  FileText,
  GitBranch,
  Loader2,
  Network,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { extractTextFromFile, RAG_UPLOAD_ACCEPT } from '@/lib/extract-file-text';
import type { PanelContentProps } from '../panel-types';

type Reference = {
  chunkId: string;
  documentId: string;
  source: string;
  text: string;
  offset: number;
  score?: number;
};

type DocumentRow = {
  id: string;
  filename: string;
  status: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  error?: string | null;
  createdAt?: string;
};

type GraphNode = { id: string; name: string; type: string; documentId?: string | null };
type GraphEdge = { source: string; target: string; relation: string; documentId?: string | null };

type Tab = 'search' | 'documents' | 'graph' | 'citations';

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `HTTP ${res.status}`);
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

function truncateFilename(name: string, max = 28): string {
  if (name.length <= max) return name;
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  const base = name.slice(0, max - ext.length - 3);
  return `${base}...${ext}`;
}

function formatBytes(value?: number | null): string {
  if (!value) return '0 B';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value?: string): string {
  if (!value) return i18n.t('rag.unknownTime');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function statusLabel(status: string): { label: string; className: string; icon: React.ReactNode } {
  if (status === 'ready') {
    return {
      label: i18n.t('rag.status.ready'),
      className: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600',
      icon: <CheckCircle2 className="size-3" />,
    };
  }
  if (status === 'failed') {
    return {
      label: i18n.t('rag.status.failed'),
      className: 'border-destructive/25 bg-destructive/10 text-destructive',
      icon: <CircleAlert className="size-3" />,
    };
  }
  if (status === 'indexing') {
    return {
      label: i18n.t('rag.status.indexing'),
      className: 'border-amber-500/25 bg-amber-500/10 text-amber-600',
      icon: <Loader2 className="size-3 animate-spin" />,
    };
  }
  if (status === 'pending') {
    return {
      label: i18n.t('rag.status.pending'),
      className: 'border-border bg-muted text-muted-foreground',
      icon: <Loader2 className="size-3 animate-spin" />,
    };
  }
  return {
    label: status || i18n.t('rag.status.unknown'),
    className: 'border-border bg-muted text-muted-foreground',
    icon: <FileText className="size-3" />,
  };
}

function StatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  tone?: string;
}) {
  return (
    <div className="border-border bg-card/60 rounded-xl border p-3">
      <div className={cn('text-muted-foreground flex items-center gap-1.5 text-[11px]', tone)}>
        {icon}
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export function RagPanel(_props: PanelContentProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('search');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [references, setReferences] = useState<Reference[]>([]);
  const [searchResults, setSearchResults] = useState<Reference[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [graph, setGraph] = useState<{ nodes: GraphNode[]; links: GraphEdge[] }>({
    nodes: [],
    links: [],
  });
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [graphSize, setGraphSize] = useState({ width: 520, height: 420 });
  const graphFgRef = useRef<ForceGraphMethods | undefined>(undefined);
  const graphRef = useRef<HTMLDivElement>(null);
  const graphSigRef = useRef<string>('');
  const fitTimerRef = useRef<number | undefined>(undefined);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fitGraphView = useCallback(() => {
    const fg = graphFgRef.current;
    if (!fg || graph.nodes.length === 0) return;
    if (fitTimerRef.current) window.clearTimeout(fitTimerRef.current);
    fitTimerRef.current = window.setTimeout(() => {
      if (graphFgRef.current) graphFgRef.current.zoomToFit(320, 48);
    }, 80);
  }, [graph.nodes.length, graph.links.length]);

  useEffect(() => {
    return () => {
      if (fitTimerRef.current) window.clearTimeout(fitTimerRef.current);
    };
  }, []);

  const stats = useMemo(() => {
    const ready = documents.filter((d) => d.status === 'ready').length;
    const failed = documents.filter((d) => d.status === 'failed').length;
    const totalSize = documents.reduce((sum, d) => sum + (d.sizeBytes ?? 0), 0);
    return {
      documents: documents.length,
      ready,
      failed,
      totalSize,
      entities: graph.nodes.length,
      edges: graph.links.length,
    };
  }, [documents, graph.links.length, graph.nodes.length]);

  const entityTypes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of graph.nodes) {
      counts.set(node.type || 'concept', (counts.get(node.type || 'concept') ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [graph.nodes]);

  async function refresh(options: { showError?: boolean; attempts?: number } = {}) {
    const { showError = false, attempts = 1 } = options;
    setRefreshing(true);
    try {
      const [refs, docs, kg] = await withRetry(
        () => Promise.all([
          fetchJson<{ references: Reference[] }>('/api/rag/references'),
          fetchJson<{ documents: DocumentRow[] }>('/api/rag/documents'),
          fetchJson<{ entities: GraphNode[]; edges: GraphEdge[] }>('/api/kg'),
        ]),
        attempts,
      );
      setReferences(refs.references ?? []);
      setDocuments(docs.documents ?? []);

      // Only replace graph data (which restarts the force simulation) when the
      // entities/edges actually changed; otherwise leave the current layout alone
      // so the 8s polling doesn't keep re-jittering and re-zooming the graph.
      const entities = kg.entities ?? [];
      const edges = kg.edges ?? [];
      const signature = JSON.stringify({
        n: entities.map((e) => `${e.id}:${e.type}:${e.name}`).sort(),
        l: edges.map((e) => `${e.source}->${e.target}:${e.relation}`).sort(),
      });
      if (signature !== graphSigRef.current) {
        graphSigRef.current = signature;
        setGraph({
          nodes: entities.map((e) => ({ id: e.id, name: e.name, type: e.type })),
          links: edges.map((e) => ({
            source: e.source,
            target: e.target,
            relation: e.relation,
          })),
        });
      }
      setError(null);
    } catch (err) {
      if (showError) {
        setError(err instanceof Error ? err.message : String(err));
      } else {
        setError(null);
      }
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void refresh({ attempts: 6 });
    const t = setInterval(() => void refresh(), 8000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (tab !== 'graph') return;
    const el = graphRef.current;
    if (!el) return;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      setGraphSize({
        width: Math.max(320, Math.floor(rect.width)),
        height: Math.max(280, Math.floor(rect.height)),
      });
    };
    updateSize();
    const observer = new ResizeObserver(() => {
      updateSize();
      fitGraphView();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [tab, fitGraphView]);

  useEffect(() => {
    if (tab === 'graph' && graph.nodes.length > 0) {
      fitGraphView();
    }
  }, [tab, graph.nodes.length, graph.links.length, graphSize.width, graphSize.height, fitGraphView]);

  async function onUpload(files: FileList | File[]) {
    const list = [...files];
    if (list.length === 0) return;
    setUploading(true);
    setError(null);
    let addedGraph = false;
    try {
      for (const file of list) {
        const { text, mimeType } = await extractTextFromFile(file);
        const result = await fetchJson<{
          graphEntities?: number;
          graphEdges?: number;
        }>('/api/rag/documents', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            filename: file.name,
            mimeType,
            text,
          }),
        });
        if ((result.graphEntities ?? 0) > 0) addedGraph = true;
      }
      await refresh({ showError: true });
      setTab(addedGraph ? 'graph' : 'documents');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  async function onDelete(documentId: string, filename: string) {
    if (!window.confirm(t('rag.confirmDelete', { filename }))) return;
    setDeletingId(documentId);
    setError(null);
    try {
      await fetchJson(`/api/rag/documents/${encodeURIComponent(documentId)}`, { method: 'DELETE' });
      await refresh({ showError: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingId(null);
    }
  }

  async function runSearch() {
    const value = query.trim();
    if (!value) {
      setError(t('rag.enterQuery'));
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const result = await fetchJson<{ references: Reference[] }>('/api/rag/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: value }),
      });
      setSearchResults(result.references ?? []);
      setReferences(result.references ?? []);
      setTab('search');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  }

  function copyReference(ref: Reference) {
    const text = `${ref.source} (offset ${ref.offset})\n${ref.text}`;
    void navigator.clipboard?.writeText(text);
  }

  return (
    <div className="bg-background flex h-full min-h-0 flex-col">
      <div className="border-border bg-background/95 shrink-0 border-b px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="bg-primary/10 text-primary flex size-8 items-center justify-center rounded-lg">
                <Sparkles className="size-4" />
              </div>
              <div>
                <div className="text-sm font-semibold">{t('rag.title')}</div>
                <div className="text-muted-foreground text-[11px]">{t('rag.subtitle')}</div>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              title={t('rag.refresh')}
              disabled={refreshing}
              onClick={() => void refresh({ showError: true, attempts: 3 })}
            >
              <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
            </Button>
            <label className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors">
              {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <UploadCloud className="size-3.5" />}
              {uploading ? t('rag.uploading') : t('rag.upload')}
              <input
                type="file"
                multiple
                className="hidden"
                accept={RAG_UPLOAD_ACCEPT}
                onChange={(e) => {
                  const files = e.target.files;
                  if (files) void onUpload(files);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
        </div>

        <div className="mt-3 flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void runSearch();
            }}
            placeholder={t('rag.searchPlaceholder')}
            className="h-8 text-xs"
            disabled={searching}
          />
          <Button
            type="button"
            size="sm"
            className="h-8 px-3 text-xs"
            disabled={searching}
            onClick={() => void runSearch()}
          >
            {searching ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
            {t('rag.search')}
          </Button>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <StatCard icon={<BookOpen className="size-3" />} label={t('rag.stat.documents')} value={stats.documents} />
          <StatCard icon={<Network className="size-3" />} label={t('rag.stat.entities')} value={stats.entities} />
          <StatCard icon={<GitBranch className="size-3" />} label={t('rag.stat.edges')} value={stats.edges} />
        </div>

        <div className="mt-3 flex gap-1 overflow-x-auto">
        {(
          [
            ['search', t('rag.tab.search')],
            ['documents', t('rag.tab.documents')],
            ['graph', t('rag.tab.graph')],
            ['citations', t('rag.tab.citations')],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={cn(
              'shrink-0 rounded-full px-2.5 py-1 text-xs transition-colors',
              tab === id
                ? 'bg-foreground text-background font-medium'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
        </div>
      </div>

      {error ? (
        <div className="border-destructive/20 bg-destructive/10 text-destructive mx-3 mt-3 rounded-lg border px-3 py-2 text-xs">
          {error}
        </div>
      ) : null}

      <div className={cn('min-h-0 flex-1', tab === 'graph' ? 'flex flex-col overflow-hidden p-3' : 'overflow-auto p-3')}>
        {tab === 'search' ? (
          <div className="space-y-3">
            {searchResults.length === 0 ? (
              <div className="border-border bg-muted/20 rounded-2xl border border-dashed p-6 text-center">
                <Search className="text-muted-foreground mx-auto size-7" />
                <div className="mt-2 text-sm font-medium">{t('rag.searchEmptyTitle')}</div>
                <div className="text-muted-foreground mt-1 text-xs">{t('rag.searchEmptyDesc')}</div>
              </div>
            ) : (
              <>
                <div className="text-muted-foreground flex items-center justify-between text-xs">
                  <span>{t('rag.foundSnippets', { count: searchResults.length })}</span>
                  <span>{t('rag.indexedSize', { size: formatBytes(stats.totalSize) })}</span>
                </div>
                <ReferenceList references={searchResults} onCopy={copyReference} />
              </>
            )}
          </div>
        ) : null}

        {tab === 'graph' ? (
          graph.nodes.length === 0 ? (
            <EmptyState
              icon={<Network className="size-7" />}
              title={t('rag.graphEmptyTitle')}
              description={t('rag.graphEmptyDesc')}
            />
          ) : (
            <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1fr_180px]">
              <div ref={graphRef} className="border-border bg-card/40 relative min-h-0 flex-1 overflow-hidden rounded-xl border">
                <ForceGraph2D
                  ref={graphFgRef}
                  key={`kg-${graph.nodes.length}-${graph.links.length}`}
                  graphData={graph}
                  nodeLabel={(n) => {
                    const node = n as GraphNode;
                    return `${node.name} (${node.type || 'concept'})`;
                  }}
                  nodeAutoColorBy="type"
                  nodeRelSize={5}
                  linkLabel={(l) => (l as GraphEdge).relation}
                  linkDirectionalArrowLength={4}
                  linkDirectionalArrowRelPos={1}
                  linkCurvature={0.08}
                  cooldownTicks={120}
                  width={graphSize.width}
                  height={graphSize.height}
                  onEngineStop={fitGraphView}
                  onNodeClick={(node) => setSelectedNode(node as GraphNode)}
                />
              </div>
              <div className="space-y-3">
                <div className="border-border rounded-xl border p-3">
                  <div className="text-xs font-medium">{t('rag.graphStats')}</div>
                  <div className="text-muted-foreground mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <div className="text-foreground text-base font-semibold">{stats.entities}</div>
                      {t('rag.stat.entities')}
                    </div>
                    <div>
                      <div className="text-foreground text-base font-semibold">{stats.edges}</div>
                      {t('rag.stat.edges')}
                    </div>
                  </div>
                </div>
                <div className="border-border rounded-xl border p-3">
                  <div className="text-xs font-medium">{t('rag.entityTypes')}</div>
                  <div className="mt-2 space-y-1.5">
                    {entityTypes.map(([type, count]) => (
                      <div key={type} className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground truncate">{type}</span>
                        <span className="rounded bg-muted px-1.5 py-0.5 tabular-nums">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
                {selectedNode ? (
                  <div className="border-border rounded-xl border p-3">
                    <div className="text-xs font-medium">{t('rag.selectedEntity')}</div>
                    <div className="mt-2 text-sm font-semibold">{selectedNode.name}</div>
                    <div className="text-muted-foreground mt-1 text-xs">{selectedNode.type}</div>
                  </div>
                ) : null}
              </div>
            </div>
          )
        ) : null}

        {tab === 'citations' ? (
          references.length === 0 ? (
            <EmptyState
              icon={<Copy className="size-7" />}
              title={t('rag.citationsEmptyTitle')}
              description={t('rag.citationsEmptyDesc')}
            />
          ) : (
            <ReferenceList references={references} onCopy={copyReference} />
          )
        ) : null}

        {tab === 'documents' ? (
          documents.length === 0 ? (
            <EmptyState
              icon={<UploadCloud className="size-7" />}
              title={t('rag.docsEmptyTitle')}
              description={t('rag.docsEmptyDesc')}
            />
          ) : (
            <div className="space-y-2">
              <div className="text-muted-foreground flex items-center justify-between text-xs">
                <span>{t('rag.docsSummary', { ready: stats.ready, failed: stats.failed })}</span>
                <span>{formatBytes(stats.totalSize)}</span>
              </div>
              {documents.map((d) => {
                const status = statusLabel(d.status);
                return (
                  <div key={d.id} className="border-border bg-card/40 rounded-xl border p-3 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <FileText className="text-muted-foreground size-4 shrink-0" />
                        <span
                          className="w-28 shrink-0 truncate font-medium"
                          title={d.filename}
                        >
                          {d.filename}
                        </span>
                        <span className="text-muted-foreground flex min-w-0 items-center gap-3 truncate">
                          <span className="shrink-0">{formatBytes(d.sizeBytes)}</span>
                          <span className="shrink-0">{formatDate(d.createdAt)}</span>
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5', status.className)}>
                          {status.icon}
                          {status.label}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          title={t('rag.delete')}
                          disabled={deletingId === d.id}
                          onClick={() => void onDelete(d.id, d.filename)}
                        >
                          {deletingId === d.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="size-3.5" />
                          )}
                        </Button>
                      </div>
                    </div>
                    {d.error ? (
                      <div className="text-destructive mt-2 rounded bg-destructive/10 px-2 py-1">
                        {d.error}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="border-border bg-muted/20 rounded-2xl border border-dashed p-6 text-center">
      <div className="text-muted-foreground mx-auto flex size-10 items-center justify-center rounded-full bg-muted">
        {icon}
      </div>
      <div className="mt-3 text-sm font-medium">{title}</div>
      <div className="text-muted-foreground mx-auto mt-1 max-w-[28rem] text-xs leading-relaxed">
        {description}
      </div>
    </div>
  );
}

function ReferenceList({
  references,
  onCopy,
}: {
  references: Reference[];
  onCopy: (ref: Reference) => void;
}) {
  const { t } = useTranslation();
  return (
    <ul className="space-y-3">
      {references.map((r, index) => (
        <li key={`${r.chunkId}-${index}`} className="border-border bg-card/40 rounded-xl border p-3 text-xs">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-medium" title={r.source}>
                {truncateFilename(r.source, 42)}
              </div>
              <div className="text-muted-foreground mt-0.5">
                offset {r.offset}
                {r.score != null ? ` · score ${r.score.toFixed(2)}` : ''}
              </div>
            </div>
            <Button type="button" variant="ghost" size="icon-xs" title={t('rag.copyReference')} onClick={() => onCopy(r)}>
              <Copy className="size-3.5" />
            </Button>
          </div>
          <div className="text-muted-foreground mt-2 max-h-44 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/40 p-2 leading-relaxed">
            {r.text}
          </div>
        </li>
      ))}
    </ul>
  );
}
