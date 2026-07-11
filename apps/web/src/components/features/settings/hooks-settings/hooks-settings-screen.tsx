import { useCallback, useEffect, useMemo, useState } from 'react';
import { Puzzle, Webhook } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  HookListItem,
  HookLogItem,
  MarketplaceEntry,
  PluginInstall,
} from '@/hooks/settings/api';
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
  FormTextarea,
  SettingsFormDialog,
} from '../settings-form-dialog';
import { SettingsDeleteDialog } from '../settings-item-actions';
import { SettingsSelect } from '../settings-select';
import {
  SettingsConnectedList,
  SettingsListIcon,
  SettingsListRow,
} from '../settings-list';

const HOOK_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'PermissionDenied',
  'Notification',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'PreCompact',
  'PostCompact',
  'SkillActivated',
] as const;

type HandlerType = 'command' | 'http' | 'prompt' | 'agent' | 'mcp_tool';

type HookForm = {
  event: string;
  matcher: string;
  type: HandlerType;
  command: string;
  url: string;
  prompt: string;
  server: string;
  tool: string;
};

const emptyForm = (): HookForm => ({
  event: 'PreToolUse',
  matcher: '',
  type: 'command',
  command: '',
  url: '',
  prompt: '',
  server: '',
  tool: '',
});

function buildHandler(form: HookForm) {
  if (form.type === 'command') return { type: 'command' as const, command: form.command.trim() };
  if (form.type === 'http') return { type: 'http' as const, url: form.url.trim() };
  if (form.type === 'prompt') return { type: 'prompt' as const, prompt: form.prompt.trim() };
  if (form.type === 'agent') return { type: 'agent' as const, prompt: form.prompt.trim() };
  return {
    type: 'mcp_tool' as const,
    server: form.server.trim(),
    tool: form.tool.trim(),
  };
}

function formFromHook(hook: HookListItem): HookForm {
  const handler = hook.handler ?? { type: hook.type };
  const base = emptyForm();
  base.event = hook.event;
  base.matcher = hook.matcher === '*' ? '' : hook.matcher;
  base.type = (handler.type as HandlerType) || (hook.type as HandlerType);
  if (handler.type === 'command') base.command = handler.command ?? '';
  if (handler.type === 'http') base.url = handler.url ?? '';
  if (handler.type === 'prompt' || handler.type === 'agent') base.prompt = handler.prompt ?? '';
  if (handler.type === 'mcp_tool') {
    base.server = handler.server ?? '';
    base.tool = handler.tool ?? '';
  }
  return base;
}

function formValid(form: HookForm): boolean {
  if (!form.event) return false;
  if (form.type === 'command') return Boolean(form.command.trim());
  if (form.type === 'http') return Boolean(form.url.trim());
  if (form.type === 'prompt' || form.type === 'agent') return Boolean(form.prompt.trim());
  return Boolean(form.server.trim() && form.tool.trim());
}

export function HooksSettingsScreen() {
  const { t } = useTranslation();
  const [hooks, setHooks] = useState<HookListItem[]>([]);
  const [marketplace, setMarketplace] = useState<MarketplaceEntry[]>([]);
  const [installedPlugins, setInstalledPlugins] = useState<PluginInstall[]>([]);
  const [logs, setLogs] = useState<HookLogItem[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<HookListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<HookListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState<HookForm>(emptyForm);

  const load = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) {
      setError(null);
    }
    try {
      const [hooksData, pluginsData] = await Promise.all([
        settingsApi.getHooks(),
        settingsApi.getPlugins(),
      ]);
      setHooks(hooksData.hooks);
      setLogs(hooksData.logs);
      setMarketplace(pluginsData.marketplace);
      setInstalledPlugins(pluginsData.installed);
    } catch (err) {
      if (!opts?.quiet) {
        setError(err instanceof Error ? err.message : t('common.loadFailed'));
      } else {
        alert(err instanceof Error ? err.message : t('common.loadFailed'));
      }
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const q = query.trim().toLowerCase();
  const loaded = useMemo(
    () =>
      hooks.filter(
        (h) =>
          !q ||
          h.event.toLowerCase().includes(q) ||
          h.source.toLowerCase().includes(q) ||
          h.type.toLowerCase().includes(q),
      ),
    [hooks, q],
  );
  const marketplaceFiltered = useMemo(
    () =>
      marketplace.filter(
        (e) =>
          !q ||
          e.name.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q),
      ),
    [marketplace, q],
  );

  const renderHookRow = (h: HookListItem) => {
    const isUser = h.source === 'user';
    const isPlugin = h.source === 'plugin';
    return (
      <SettingsListRow
        key={h.key}
        icon={
          <SettingsListIcon statusDot={h.enabled && !h.dormant}>
            <Webhook className="size-4" />
          </SettingsListIcon>
        }
        title={`${h.event} · ${h.type}`}
        subtitle={`${h.source}${h.sourceId ? `:${h.sourceId}` : ''} · matcher ${h.matcher}${
          h.dormant ? ` · ${t('customize.hooksPage.dormant')}` : ''
        }${h.configPath ? ` · ${h.configPath}` : ''}`}
        menuItems={[
          {
            label: h.enabled ? t('common.disable') : t('common.enable'),
            onClick: () => {
              void settingsApi
                .setHookDisabled(h.key, h.enabled)
                .then(() => load({ quiet: true }))
                .catch((err) => {
                  alert(err instanceof Error ? err.message : String(err));
                });
            },
          },
          ...(isUser
            ? [
                { label: t('common.edit'), onClick: () => openEdit(h) },
                {
                  label: t('common.delete'),
                  onClick: () => setDeleteTarget(h),
                  destructive: true,
                },
              ]
            : isPlugin
              ? [
                  {
                    label: t('common.delete'),
                    onClick: () => setDeleteTarget(h),
                    destructive: true,
                  },
                ]
              : []),
        ]}
      />
    );
  };

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setDialogOpen(true);
  };

  const openEdit = (hook: HookListItem) => {
    setEditing(hook);
    setForm(formFromHook(hook));
    setDialogOpen(true);
  };

  const saveHook = async () => {
    if (!formValid(form)) return;
    try {
      const body = {
        event: form.event,
        matcher: form.matcher.trim() || undefined,
        handler: buildHandler(form),
      };
      if (editing) {
        await settingsApi.updateHook(editing.key, body);
      } else {
        await settingsApi.createHook(body);
      }
      setDialogOpen(false);
      setEditing(null);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      if (deleteTarget.source === 'plugin') {
        const pluginName = deleteTarget.sourceId;
        const plugin = installedPlugins.find((p) => p.name === pluginName);
        if (!plugin) throw new Error(t('customize.hooksPage.pluginNotFound'));
        await settingsApi.uninstallPlugin(plugin.id);
      } else {
        await settingsApi.deleteHook(deleteTarget.key);
      }
      setDeleteTarget(null);
      await load({ quiet: true });
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  const installFromMarket = async (name: string) => {
    try {
      const existing = installedPlugins.find((p) => p.name === name);
      if (existing) {
        if (!existing.enabled) {
          await settingsApi.setPluginEnabled(existing.id, true);
        }
        await load({ quiet: true });
        alert(t('customize.hooksPage.alreadyInstalled', { name }));
        return;
      }
      const res = await settingsApi.installPlugin({ type: 'marketplace', name });
      if (!res.ok) {
        alert(res.message ?? t('customize.pluginsPage.installFailed'));
        return;
      }
      await load({ quiet: true });
      alert(t('customize.hooksPage.installSuccess', { name }));
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  if (error && hooks.length === 0) {
    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-3">
        <p className="text-muted-foreground text-sm">{error}</p>
        <button
          type="button"
          className="border-border rounded-md border px-3 py-1.5 text-sm"
          onClick={() => void load()}
        >
          {t('common.retry')}
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={t('customize.hooksPage.title')}
        description={t('customize.hooksPage.description')}
        action={
          <PrimaryActionButton onClick={openCreate}>{t('customize.hooksPage.addHook')}</PrimaryActionButton>
        }
      />
      <PageSearchBar value={query} onChange={setQuery} placeholder={t('customize.hooksPage.searchPlaceholder')} />

      <SettingsFormDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditing(null);
        }}
        title={editing ? t('customize.hooksPage.editTitle') : t('customize.hooksPage.addTitle')}
        description={t('customize.hooksPage.editorDescription')}
        submitLabel={editing ? t('common.saveChanges') : t('customize.hooksPage.addHook')}
        onSubmit={() => void saveHook()}
        onCancel={() => setEditing(null)}
      >
        <FormField label={t('customize.hooksPage.event')} required>
          <SettingsSelect
            value={form.event}
            onChange={(e) => setForm((f) => ({ ...f, event: e.target.value }))}
          >
            {HOOK_EVENTS.map((event) => (
              <option key={event} value={event}>
                {event}
              </option>
            ))}
          </SettingsSelect>
        </FormField>
        <FormField label={t('customize.hooksPage.matcher')} hint={t('customize.hooksPage.matcherHint')}>
          <FormInput
            value={form.matcher}
            onChange={(e) => setForm((f) => ({ ...f, matcher: e.target.value }))}
            placeholder="*"
          />
        </FormField>
        <FormField label={t('customize.hooksPage.handlerType')} required>
          <SettingsSelect
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as HandlerType }))}
          >
            <option value="command">command</option>
            <option value="http">http</option>
            <option value="prompt">prompt</option>
            <option value="agent">agent</option>
            <option value="mcp_tool">mcp_tool</option>
          </SettingsSelect>
        </FormField>
        {form.type === 'command' ? (
          <FormField label="command" required>
            <FormInput
              value={form.command}
              onChange={(e) => setForm((f) => ({ ...f, command: e.target.value }))}
              placeholder="echo hello"
            />
          </FormField>
        ) : null}
        {form.type === 'http' ? (
          <FormField label="url" required>
            <FormInput
              value={form.url}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              placeholder="https://example.com/hook"
            />
          </FormField>
        ) : null}
        {form.type === 'prompt' || form.type === 'agent' ? (
          <FormField label="prompt" required>
            <FormTextarea
              value={form.prompt}
              onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
              placeholder="Evaluate whether…"
            />
          </FormField>
        ) : null}
        {form.type === 'mcp_tool' ? (
          <>
            <FormField label="server" required>
              <FormInput
                value={form.server}
                onChange={(e) => setForm((f) => ({ ...f, server: e.target.value }))}
              />
            </FormField>
            <FormField label="tool" required>
              <FormInput
                value={form.tool}
                onChange={(e) => setForm((f) => ({ ...f, tool: e.target.value }))}
              />
            </FormField>
          </>
        ) : null}
      </SettingsFormDialog>

      <section className="mb-8">
        <SectionHeading title={t('customize.hooksPage.loaded')} count={loaded.length} />
        {loaded.length > 0 ? (
          <SettingsConnectedList>{loaded.map(renderHookRow)}</SettingsConnectedList>
        ) : (
          <p className="text-muted-foreground mb-6 text-sm">{t('customize.hooksPage.loadedEmpty')}</p>
        )}
      </section>

      <section className="mb-8">
        <SectionHeading title={t('customize.hooksPage.marketplace')} count={marketplaceFiltered.length} />
        {marketplaceFiltered.length > 0 ? (
          <SettingsConnectedList>
            {marketplaceFiltered.map((entry) => (
              <SettingsListRow
                key={entry.name}
                icon={
                  <SettingsListIcon>
                    <Puzzle className="size-4" />
                  </SettingsListIcon>
                }
                title={entry.name}
                subtitle={entry.description}
                menuItems={[
                  {
                    label: t('customize.hooksPage.installFromMarket'),
                    onClick: () => {
                      void installFromMarket(entry.name);
                    },
                  },
                ]}
              />
            ))}
          </SettingsConnectedList>
        ) : (
          <p className="text-muted-foreground mb-6 text-sm">{t('customize.hooksPage.marketplaceEmpty')}</p>
        )}
      </section>

      {logs.length > 0 ? (
        <section className="mb-8">
          <SectionHeading title={t('customize.hooksPage.recentLogs')} count={logs.length} />
          <ul className="text-muted-foreground space-y-2 text-sm">
            {logs.slice(0, 20).map((log) => (
              <li key={log.id} className="border-border rounded-md border px-3 py-2">
                <span className="text-foreground font-medium">{log.event}</span>
                {' · '}
                {log.source}
                {log.decision ? ` · ${log.decision}` : ''}
                {log.durationMs != null ? ` · ${log.durationMs}ms` : ''}
                {log.error ? ` · ${log.error}` : ''}
                {log.dormant ? ` · ${t('customize.hooksPage.dormant')}` : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <SettingsDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={
          deleteTarget?.source === 'plugin'
            ? t('customize.hooksPage.deletePluginTitle')
            : t('customize.hooksPage.deleteTitle')
        }
        description={
          deleteTarget?.source === 'plugin'
            ? t('customize.hooksPage.confirmDeletePlugin', {
                name: deleteTarget.sourceId ?? deleteTarget.key,
              })
            : t('customize.hooksPage.confirmDelete')
        }
        onConfirm={confirmDelete}
        busy={deleting}
      />
    </div>
  );
}
