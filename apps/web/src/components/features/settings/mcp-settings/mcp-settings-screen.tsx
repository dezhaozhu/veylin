import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { McpServer, McpHealthSnapshot, McpServerHealth } from '@/hooks/settings/api';
import { settingsApi } from '@/hooks/settings/api';
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
  SettingsFormDialog,
} from '../settings-form-dialog';
import { SettingsDeleteDialog } from '../settings-item-actions';
import {
  SettingsConnectedList,
  SettingsListIcon,
  SettingsListRow,
} from '../settings-list';
import { mcpServerIcon } from '@/lib/mcp-icon';

const LIBRARY = [
  {
    id: 'github',
    name: 'GitHub',
    transport: 'HTTP',
    descriptionKey: 'customize.mcpPage.library.github',
  },
  {
    id: 'slack',
    name: 'Slack',
    transport: 'HTTP',
    descriptionKey: 'customize.mcpPage.library.slack',
  },
  {
    id: 'linear',
    name: 'Linear',
    transport: 'HTTP',
    descriptionKey: 'customize.mcpPage.library.linear',
  },
  {
    id: 'notion',
    name: 'Notion',
    transport: 'HTTP',
    descriptionKey: 'customize.mcpPage.library.notion',
  },
  {
    id: 'tavily',
    name: 'Tavily',
    transport: 'HTTP',
    descriptionKey: 'customize.mcpPage.library.tavily',
  },
  {
    id: 'supabase',
    name: 'Supabase',
    transport: 'HTTP',
    descriptionKey: 'customize.mcpPage.library.supabase',
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

function McpIcon({ name, enabled }: { name: string; enabled: boolean }) {
  const label = mcpServerIcon(name).label;
  return (
    <SettingsListIcon statusDot={enabled} className="text-[10px] font-semibold">
      <span>{label}</span>
    </SettingsListIcon>
  );
}

function InstalledRow({
  item,
  health,
  onToggle,
  onDelete,
}: {
  item: InstalledItem;
  health?: McpServerHealth;
  onToggle: (enabled: boolean) => void;
  onDelete?: () => void;
}) {
  const { t } = useTranslation();

  const statusLine =
    item.enabled && health
      ? health.connected
        ? t('customize.mcpPage.toolsCount', { count: health.toolCount })
        : t('customize.mcpPage.disconnected')
      : null;

  const menuItems = [
    {
      label: item.enabled ? t('common.disable') : t('common.enable'),
      onClick: () => onToggle(!item.enabled),
    },
    ...(onDelete
      ? [{ label: t('common.delete'), onClick: onDelete, destructive: true }]
      : []),
  ];

  return (
    <SettingsListRow
      icon={<McpIcon name={item.name} enabled={item.enabled} />}
      title={item.name}
      subtitle={t('customize.mcpPage.serverLine', {
        transport: item.transport,
        detail: statusLine ? `${item.detail} · ${statusLine}` : item.detail,
      })}
      subtitleAction
      menuItems={menuItems}
    />
  );
}

export function McpSettingsScreen() {
  const { t } = useTranslation();
  const [bundled, setBundled] = useState<string[]>([]);
  const [remote, setRemote] = useState<McpServer[]>([]);
  const [disabledMcp, setDisabledMcp] = useState<Set<string>>(new Set());
  const [health, setHealth] = useState<McpHealthSnapshot | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'installed' | 'library'>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<InstalledItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState({
    name: '',
    transport: 'sse' as 'sse' | 'http',
    url: '',
    headers: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await settingsApi.getMcpServers();
      setBundled(data.bundled);
      setRemote(data.remote);
      setDisabledMcp(new Set(data.disabledMcp ?? []));
      setHealth(data.health);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('customize.mcpPage.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const reconnect = useCallback(async () => {
    setReconnecting(true);
    try {
      const data = await settingsApi.reconnectMcpServers();
      setHealth(data.health);
    } finally {
      setReconnecting(false);
    }
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
      (!q || item.name.toLowerCase().includes(q) || t(item.descriptionKey).toLowerCase().includes(q)),
  );

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

  const confirmDelete = async () => {
    if (!deleteTarget?.remoteId || deleting) return;
    setDeleting(true);
    try {
      await settingsApi.deleteMcpServer(deleteTarget.remoteId);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      alert(t('customize.mcpPage.deleteFailed', { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setDeleting(false);
    }
  };

  const save = async () => {
    if (!form.name.trim() || !form.url.trim()) return;
    let headers: Record<string, string> = {};
    if (form.headers.trim()) {
      try {
        headers = JSON.parse(form.headers) as Record<string, string>;
      } catch {
        alert(t('customize.mcpPage.headersJsonError'));
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
      alert(t('customize.mcpPage.addFailed', { error: err instanceof Error ? err.message : String(err) }));
    }
  };

  const openLibraryAdd = (name: string, transport: 'sse' | 'http' = 'http') => {
    setForm({ name: name.toLowerCase(), transport, url: '', headers: '' });
    setDialogOpen(true);
  };

  const healthByName = useMemo(() => {
    const map = new Map<string, McpServerHealth>();
    for (const server of health?.servers ?? []) {
      map.set(server.name, server);
    }
    return map;
  }, [health]);

  const hasConnectionIssues =
    Boolean(health?.lastError) ||
    (health?.servers ?? []).some((server) => !server.connected);

  if (loading) {
    return <div className="text-muted-foreground text-sm">{t('customize.mcpPage.loading')}</div>;
  }

  if (loadError) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col items-start gap-3">
        <p className="text-muted-foreground text-sm">{t('customize.mcpPage.loadFailed')}</p>
        <button
          type="button"
          className="text-foreground border-border hover:bg-muted rounded-md border px-3 py-1.5 text-sm"
          onClick={() => void load()}
        >
          {t('common.retry')}
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={t('customize.mcpPage.title')}
        description={t('customize.mcpPage.description')}
        action={
          <PrimaryActionButton
            onClick={() => {
              setForm({ name: '', transport: 'sse', url: '', headers: '' });
              setDialogOpen(true);
            }}
          >
            {t('customize.mcpPage.addCustom')}
          </PrimaryActionButton>
        }
      />

      {(health?.lastError || hasConnectionIssues) && (
        <div className="border-destructive/30 bg-destructive/5 mb-4 rounded-lg border px-4 py-3 text-sm">
          <p className="text-destructive font-medium">{t('customize.mcpPage.connectionFailed')}</p>
          {health?.lastError && (
            <p className="text-muted-foreground mt-1 text-xs">{health.lastError}</p>
          )}
          <button
            type="button"
            className="text-primary mt-2 text-xs underline"
            disabled={reconnecting}
            onClick={() => void reconnect()}
          >
            {reconnecting ? t('customize.mcpPage.reconnecting') : t('customize.mcpPage.reconnect')}
          </button>
        </div>
      )}

      <PageSearchBar
        value={query}
        onChange={setQuery}
        placeholder={t('customize.mcpPage.searchPlaceholder')}
        filter={
          <FormSelect
            className="w-auto min-w-[8rem]"
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
          >
            <option value="all">{t('customize.mcpPage.filterAll')}</option>
            <option value="installed">{t('customize.mcpPage.installed')}</option>
            <option value="library">{t('customize.mcpPage.libraryTitle')}</option>
          </FormSelect>
        }
      />

      <SettingsFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={t('customize.mcpPage.addTitle')}
        description={t('customize.mcpPage.editorDescription')}
        submitLabel={t('customize.mcpPage.addServer')}
        onSubmit={() => void save()}
      >
        <FormField label={t('common.name')} required>
          <FormInput
            placeholder={t('customize.mcpPage.namePlaceholder')}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </FormField>
        <FormField label={t('customize.mcpPage.transport')} hint={t('customize.mcpPage.transportHint')}>
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
          label={t('customize.mcpPage.headers')}
          hint={t('customize.mcpPage.headersHint')}
        >
          <FormTextarea
            className="min-h-20 font-mono text-xs"
            placeholder='{"Authorization":"Bearer ..."}'
            value={form.headers}
            onChange={(e) => setForm((f) => ({ ...f, headers: e.target.value }))}
          />
        </FormField>
      </SettingsFormDialog>

      {showInstalled && (
        <section className="mb-8">
          <SectionHeading
            title={t('customize.mcpPage.connected')}
            count={installedItems.length}
          />
          {installedItems.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('customize.mcpPage.noInstalledMatch')}</p>
          ) : (
            <SettingsConnectedList>
              {installedItems.map((item) => (
                <InstalledRow
                  key={item.key}
                  item={item}
                  health={healthByName.get(item.name)}
                  onToggle={(on) => void toggleInstalled(item, on)}
                  onDelete={item.source === 'remote' ? () => setDeleteTarget(item) : undefined}
                />
              ))}
            </SettingsConnectedList>
          )}
        </section>
      )}

      {showLibrary && (
        <section>
          <SectionHeading title={t('customize.mcpPage.libraryTitle')} count={libraryItems.length} />
          {libraryItems.length > 0 ? (
            <SettingsConnectedList>
              {libraryItems.map((item) => {
                const installed = installedNames.has(item.id) || installedNames.has(item.name.toLowerCase());
                return (
                  <SettingsListRow
                    key={item.id}
                    asButton={!installed}
                    onClick={() => !installed && openLibraryAdd(item.name)}
                    icon={
                      <SettingsListIcon className="text-[10px] font-semibold">
                        <span>{item.name.slice(0, 2).toUpperCase()}</span>
                      </SettingsListIcon>
                    }
                    title={item.name}
                    subtitle={t(item.descriptionKey)}
                    trailing={
                      installed ? (
                        <Check className="text-emerald-600 size-4 shrink-0" />
                      ) : undefined
                    }
                  />
                );
              })}
            </SettingsConnectedList>
          ) : null}
        </section>
      )}

      <SettingsDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t('customize.mcpPage.deleteTitle')}
        description={t('customize.mcpPage.confirmDelete', { name: deleteTarget?.name ?? '' })}
        onConfirm={confirmDelete}
        busy={deleting}
      />
    </div>
  );
}
