import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import type { McpServer } from '@/hooks/settings/api';
import { settingsApi } from '@/hooks/settings/api';
import { SettingsSwitch } from '../settings-switch';
import {
  PageHeader,
  PageSearchBar,
  PrimaryActionButton,
  SectionHeading,
} from '../page-header';
import {
  FormField,
  FormInput,
  FormSelect,
  FormTextarea,
  SettingsInlineEditor,
} from '../settings-form-dialog';
import { mcpServerIcon } from '@/lib/mcp-icon';
import { cn } from '@/lib/utils';

const LIBRARY = [
  {
    id: 'github',
    name: 'GitHub',
    transport: 'HTTP',
    description: 'Review PRs, triage issues, and post summaries from repository events.',
  },
  {
    id: 'slack',
    name: 'Slack',
    transport: 'HTTP',
    description: 'Send automation digests and alerts to channels your team already uses.',
  },
  {
    id: 'linear',
    name: 'Linear',
    transport: 'HTTP',
    description: 'Sync issue status and create follow-up tasks from agent workflows.',
  },
  {
    id: 'notion',
    name: 'Notion',
    transport: 'HTTP',
    description: 'Publish reports and structured notes to shared team workspaces.',
  },
  {
    id: 'tavily',
    name: 'Tavily',
    transport: 'HTTP',
    description: 'Web search and research for agents that need fresh external context.',
  },
  {
    id: 'supabase',
    name: 'Supabase',
    transport: 'HTTP',
    description: 'Query project data and run operational checks against your database.',
  },
] as const;

type InstalledItem = {
  key: string;
  name: string;
  transport: string;
  detail: string;
  enabled: boolean;
  source: 'bundled' | 'remote';
  remoteId?: string;
};

function InstalledCard({
  item,
  onToggle,
  onDelete,
}: {
  item: InstalledItem;
  onToggle: (enabled: boolean) => void;
  onDelete?: () => void;
}) {
  const icon = mcpServerIcon(item.name);
  return (
    <div className="border-border bg-card flex min-w-[280px] flex-1 items-center gap-3 rounded-xl border px-4 py-3">
      <div
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-white',
          icon.bg,
        )}
      >
        {icon.label}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{item.name}</div>
        <div className="text-muted-foreground truncate text-xs">
          <span className="font-medium">{item.transport}</span>
          <span className="mx-1">·</span>
          {item.detail}
        </div>
      </div>
      <SettingsSwitch
        checked={item.enabled}
        onChange={onToggle}
        label={`Toggle ${item.name}`}
      />
      {onDelete && (
        <button
          type="button"
          className="text-destructive hover:bg-destructive/10 rounded-md px-2 py-1 text-xs underline"
          onClick={onDelete}
        >
          Delete
        </button>
      )}
    </div>
  );
}

export function McpSettingsScreen() {
  const [bundled, setBundled] = useState<string[]>([]);
  const [remote, setRemote] = useState<McpServer[]>([]);
  const [disabledMcp, setDisabledMcp] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'installed' | 'library'>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({
    name: '',
    transport: 'sse' as 'sse' | 'http',
    url: '',
    headers: '',
  });

  const load = useCallback(async () => {
    const data = await settingsApi.getMcpServers();
    setBundled(data.bundled);
    setRemote(data.remote);
    setDisabledMcp(new Set(data.disabledMcp ?? []));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const installedNames = useMemo(
    () => new Set([...bundled, ...remote.map((r) => r.name)]),
    [bundled, remote],
  );

  const q = query.trim().toLowerCase();
  const installedItems: InstalledItem[] = [
    ...bundled.map((name) => ({
      key: `bundled-${name}`,
      name,
      transport: 'STDIO',
      detail: `tsx ${name}-server`,
      enabled: !disabledMcp.has(name),
      source: 'bundled' as const,
    })),
    ...remote.map((s) => ({
      key: s.id,
      name: s.name,
      transport: s.transport.toUpperCase(),
      detail: s.url,
      enabled: s.enabled,
      source: 'remote' as const,
      remoteId: s.id,
    })),
  ].filter((item) => !q || item.name.toLowerCase().includes(q) || item.detail.toLowerCase().includes(q));

  const libraryItems = LIBRARY.filter(
    (item) =>
      (filter === 'all' || filter === 'library') &&
      (!q || item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q)),
  ).slice(0, 1);

  const showInstalled = filter === 'all' || filter === 'installed';
  const showLibrary = filter === 'all' || filter === 'library';

  const toggleInstalled = async (item: InstalledItem, enabled: boolean) => {
    if (item.source === 'bundled') {
      const next = new Set(disabledMcp);
      if (enabled) next.delete(item.name);
      else next.add(item.name);
      setDisabledMcp(next);
      await settingsApi.saveDisabledMcp([...next]);
    } else if (item.remoteId) {
      await settingsApi.updateMcpServer(item.remoteId, { enabled });
      await load();
    }
  };

  const deleteInstalled = async (item: InstalledItem) => {
    if (item.source !== 'remote' || !item.remoteId) return;
    if (!confirm(`Delete MCP server "${item.name}"?`)) return;
    try {
      await settingsApi.deleteMcpServer(item.remoteId);
      await load();
    } catch (err) {
      alert(`Failed to delete server: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const save = async () => {
    if (!form.name.trim() || !form.url.trim()) return;
    let headers: Record<string, string> = {};
    if (form.headers.trim()) {
      try {
        headers = JSON.parse(form.headers) as Record<string, string>;
      } catch {
        alert('Headers must be valid JSON');
        return;
      }
    }
    try {
      await settingsApi.createMcpServer({
        name: form.name,
        transport: form.transport,
        url: form.url,
        headers,
      });
      setDialogOpen(false);
      setForm({ name: '', transport: 'sse', url: '', headers: '' });
      await load();
    } catch (err) {
      alert(`Failed to add server: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const openLibraryAdd = (name: string, transport: 'sse' | 'http' = 'http') => {
    setForm({ name: name.toLowerCase(), transport, url: '', headers: '' });
    setDialogOpen(true);
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Model Context Protocol (MCP)"
        description="Add Model Context Protocol servers to expand what your agent can do. Toggle installed servers on or off without uninstalling."
        action={
          <PrimaryActionButton onClick={() => setDialogOpen(true)}>
            Add custom server
          </PrimaryActionButton>
        }
      />

      <PageSearchBar
        value={query}
        onChange={setQuery}
        placeholder="Search MCP servers…"
        filter={
          <select
            className="border-input bg-background h-10 rounded-lg border px-3 text-sm"
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
          >
            <option value="all">All</option>
            <option value="installed">Installed</option>
            <option value="library">Library</option>
          </select>
        }
      />

      <SettingsInlineEditor
        open={dialogOpen}
        title="Add MCP server"
        description="Connect a remote MCP server over SSE or HTTP."
        submitLabel="Add server"
        onSubmit={() => void save()}
        onCancel={() => setDialogOpen(false)}
      >
        <FormField label="Name" required>
          <FormInput
            placeholder="e.g. github"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </FormField>
        <FormField label="Transport" hint="SSE for streaming endpoints; HTTP for streamable HTTP MCP.">
          <FormSelect
            value={form.transport}
            onChange={(e) =>
              setForm((f) => ({ ...f, transport: e.target.value as 'sse' | 'http' }))
            }
          >
            <option value="sse">SSE</option>
            <option value="http">HTTP</option>
          </FormSelect>
        </FormField>
        <FormField label="URL" required>
          <FormInput
            placeholder="https://mcp.example.com/sse"
            value={form.url}
            onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
          />
        </FormField>
        <FormField
          label="Headers"
          hint='Optional JSON object, e.g. {"Authorization":"Bearer ..."}'
        >
          <FormTextarea
            className="min-h-20 font-mono text-xs"
            placeholder='{"Authorization":"Bearer ..."}'
            value={form.headers}
            onChange={(e) => setForm((f) => ({ ...f, headers: e.target.value }))}
          />
        </FormField>
      </SettingsInlineEditor>

      {showInstalled && (
        <section className="mb-8">
          <SectionHeading title="Installed" count={installedItems.length} />
          <div className="flex flex-col gap-2">
            {installedItems.length === 0 && (
              <p className="text-muted-foreground text-sm">No installed servers match your search.</p>
            )}
            <div className="flex flex-wrap gap-2">
              {installedItems.map((item) => (
                <InstalledCard
                  key={item.key}
                  item={item}
                  onToggle={(on) => void toggleInstalled(item, on)}
                  onDelete={item.source === 'remote' ? () => void deleteInstalled(item) : undefined}
                />
              ))}
            </div>
          </div>
        </section>
      )}

      {showLibrary && (
        <section>
          <SectionHeading title="Library" count={libraryItems.length} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {libraryItems.map((item) => {
              const installed = installedNames.has(item.id) || installedNames.has(item.name.toLowerCase());
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => !installed && openLibraryAdd(item.name)}
                  className={cn(
                    'border-border bg-card group relative rounded-xl border p-4 text-left transition-colors',
                    !installed && 'hover:border-foreground/20 hover:bg-accent/30',
                    installed && 'opacity-70',
                  )}
                >
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div className="bg-muted flex size-9 items-center justify-center rounded-lg text-xs font-bold">
                      {item.name.slice(0, 2).toUpperCase()}
                    </div>
                    {!installed ? (
                      <span className="border-border text-muted-foreground flex size-7 items-center justify-center rounded-md border opacity-0 transition-opacity group-hover:opacity-100">
                        <Plus className="size-4" />
                      </span>
                    ) : (
                      <Check className="text-emerald-600 size-4" />
                    )}
                  </div>
                  <div className="font-medium">{item.name}</div>
                  <div className="text-muted-foreground mb-2 text-[10px] font-medium tracking-wide uppercase">
                    {item.transport}
                  </div>
                  <p className="text-muted-foreground line-clamp-2 text-xs leading-relaxed">
                    {item.description}
                  </p>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
