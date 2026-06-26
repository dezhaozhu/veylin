import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAui } from '@assistant-ui/store';
import { useTranslation } from 'react-i18next';
import {
  Clock,
  FolderGit2,
  MoreVertical,
  Play,
  Plus,
  Tag,
} from 'lucide-react';
import type { Automation, AutomationRun, WebhookEndpoint } from '@/hooks/settings/api';
import { settingsApi } from '@/hooks/settings/api';
import { useSettingsPanel } from '@/hooks/settings/use-settings-panel';
import {
  PageHeader,
  PageSearchBar,
  PrimaryActionButton,
  SectionHeading,
} from '../page-header';
import { Button } from '@/components/ui/button';
import {
  FormField,
  FormInput,
  FormSelect,
  FormTextarea,
  SettingsInlineEditor,
} from '../settings-form-dialog';
import { cn } from '@/lib/utils';

const TEMPLATES = [
  {
    id: 'pr-triage',
    nameKey: 'automate.templates.prTriage.name',
    categoryKey: 'automate.templates.prTriage.category',
    icon: 'GH',
    descriptionKey: 'automate.templates.prTriage.description',
    promptKey: 'automate.templates.prTriage.prompt',
  },
  {
    id: 'security-pass',
    nameKey: 'automate.templates.securityPass.name',
    categoryKey: 'automate.templates.securityPass.category',
    icon: 'GH',
    descriptionKey: 'automate.templates.securityPass.description',
    promptKey: 'automate.templates.securityPass.prompt',
  },
  {
    id: 'slack-digest',
    nameKey: 'automate.templates.slackDigest.name',
    categoryKey: 'automate.templates.slackDigest.category',
    icon: 'SL',
    descriptionKey: 'automate.templates.slackDigest.description',
    promptKey: 'automate.templates.slackDigest.prompt',
  },
  {
    id: 'incident-hook',
    nameKey: 'automate.templates.incidentHook.name',
    categoryKey: 'automate.templates.incidentHook.category',
    icon: 'WH',
    descriptionKey: 'automate.templates.incidentHook.description',
    promptKey: 'automate.templates.incidentHook.prompt',
  },
] as const;

type CreatedHook = { url: string; secret: string; sourceType: 'github' | 'custom' };

function buildWebhookCurl({ url, secret, sourceType }: CreatedHook): string {
  const sigHeader = sourceType === 'github' ? 'X-Hub-Signature-256' : 'X-Signature-256';
  const sigValue = sourceType === 'github' ? 'sha256=$SIG' : '$SIG';
  return [
    `SECRET='${secret}'`,
    `BODY='{"event":"test"}'`,
    `SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')`,
    `curl -X POST '${url}' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -H "${sigHeader}: ${sigValue}" \\`,
    `  -d "$BODY"`,
  ].join('\n');
}

function MetaPill({ icon: Icon, children }: { icon: typeof Clock; children: ReactNode }) {
  return (
    <span className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px]">
      <Icon className="size-3 opacity-70" />
      {children}
    </span>
  );
}

function AutomationCard({
  automation,
  onRun,
  onToggle,
  onEdit,
  onDelete,
  onSelect,
}: {
  automation: Automation;
  onRun: () => void;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const scheduleLabel =
    automation.kind === 'schedule'
      ? automation.cron ?? t('automate.scheduled')
      : automation.sourceType === 'github'
        ? t('automate.runsOnGithubEvents')
        : t('automate.eventDriven');

  return (
    <div
      className={cn(
        'border-border bg-card group relative flex flex-col rounded-xl border p-4 transition-colors hover:border-foreground/15',
        !automation.enabled && 'opacity-75',
      )}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <button type="button" className="text-left" onClick={onSelect}>
          <h3 className="font-medium leading-snug">{automation.name}</h3>
        </button>
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground rounded px-1.5 py-1 text-xs"
            onClick={onEdit}
            aria-label={t('common.edit')}
          >
            {t('common.edit')}
          </button>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground rounded p-1"
            onClick={onDelete}
            aria-label={t('common.delete')}
          >
            <MoreVertical className="size-4" />
          </button>
        </div>
      </div>
      <p className="text-muted-foreground mb-4 line-clamp-2 flex-1 text-sm leading-relaxed">
        {automation.prompt}
      </p>
      <div className="mb-4 flex flex-wrap gap-1.5">
        <MetaPill icon={FolderGit2}>{automation.agentId}</MetaPill>
        <MetaPill icon={Clock}>{scheduleLabel}</MetaPill>
        <MetaPill icon={Tag}>{t(`automate.kind.${automation.kind}`)}</MetaPill>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="rounded-lg"
          onClick={onRun}
          disabled={!automation.enabled}
          title={automation.enabled ? t('automate.runNow') : t('automate.enableToRun')}
        >
          <Play className="mr-1.5 size-3.5" />
          {t('automate.runNow')}
        </Button>
        <Button size="sm" variant="ghost" className="rounded-lg text-xs" onClick={onToggle}>
          {automation.enabled ? t('common.disable') : t('common.enable')}
        </Button>
      </div>
    </div>
  );
}

const EMPTY_FORM = {
  name: '',
  kind: 'schedule' as 'schedule' | 'event',
  agentId: 'veylin',
  prompt: '',
  cron: '0 9 * * 1-5',
  timezone: 'UTC',
  sourceType: 'cron',
  triggerFilter: '{}',
};

export function AutomationsSettingsScreen() {
  const { t } = useTranslation();
  const aui = useAui();
  const { closeWorkspace } = useSettingsPanel();
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookEndpoint[]>([]);
  const [query, setQuery] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [createdHook, setCreatedHook] = useState<CreatedHook | null>(null);
  const [hookError, setHookError] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const openRunThread = useCallback(
    async (threadId: string) => {
      try {
        const threads = aui.threads();
        await threads.reload?.();
        threads.switchToThread(threadId);
        closeWorkspace();
      } catch {
        // Thread may not be loaded yet; surface a gentle hint.
        alert(t('automate.openRunFailed'));
      }
    },
    [aui, closeWorkspace],
  );

  const load = useCallback(async () => {
    const [autoData, hookData] = await Promise.all([
      settingsApi.getAutomations(),
      settingsApi.getWebhooks(),
    ]);
    setAutomations(autoData.automations);
    setWebhooks(hookData.endpoints);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!detailId) {
      setRuns([]);
      return;
    }
    void settingsApi.getAutomationRuns(detailId).then((d) => setRuns(d.runs));
  }, [detailId]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      automations.filter(
        (a) =>
          !q ||
          a.name.toLowerCase().includes(q) ||
          a.prompt.toLowerCase().includes(q) ||
          a.agentId.toLowerCase().includes(q),
      ),
    [automations, q],
  );

  const active = filtered.filter((a) => a.enabled);
  const inactive = filtered.filter((a) => !a.enabled);
  const detail = automations.find((a) => a.id === detailId) ?? null;

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setDialogOpen(true);
  };

  const openEdit = (automation: Automation) => {
    setEditingId(automation.id);
    setForm({
      name: automation.name,
      kind: automation.kind,
      agentId: automation.agentId,
      prompt: automation.prompt,
      cron: automation.cron ?? '0 9 * * 1-5',
      timezone: automation.timezone ?? 'UTC',
      sourceType: automation.sourceType ?? (automation.kind === 'event' ? 'github' : 'cron'),
      triggerFilter: JSON.stringify(automation.triggerFilter ?? {}, null, 2),
    });
    setDialogOpen(true);
  };

  const save = async () => {
    if (!form.name.trim() || !form.prompt.trim()) return;
    let triggerFilter: Record<string, unknown> = {};
    try {
      triggerFilter = JSON.parse(form.triggerFilter || '{}') as Record<string, unknown>;
    } catch {
      alert(t('automate.triggerFilterJsonError'));
      return;
    }
    const body = {
      name: form.name,
      kind: form.kind,
      agentId: form.agentId,
      prompt: form.prompt,
      cron: form.kind === 'schedule' ? form.cron : undefined,
      timezone: form.timezone,
      sourceType: form.kind === 'event' ? form.sourceType : 'cron',
      triggerFilter,
    };
    if (editingId) await settingsApi.updateAutomation(editingId, body);
    else await settingsApi.createAutomation(body);
    setDialogOpen(false);
    setEditingId(null);
    await load();
  };

  const applyTemplate = (template: (typeof TEMPLATES)[number]) => {
    setEditingId(null);
    setForm({
      ...EMPTY_FORM,
      name: t(template.nameKey),
      prompt: t(template.promptKey),
      kind: template.id === 'incident-hook' ? 'event' : 'schedule',
      sourceType: template.id === 'incident-hook' ? 'github' : 'cron',
    });
    setDialogOpen(true);
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={t('automate.title')}
        description={t('automate.description')}
        action={<PrimaryActionButton onClick={openCreate}>{t('automate.addAutomation')}</PrimaryActionButton>}
      />

      <PageSearchBar value={query} onChange={setQuery} placeholder={t('automate.searchPlaceholder')} />

      <SettingsInlineEditor
        open={dialogOpen}
        title={editingId ? t('automate.editTitle') : t('automate.addTitle')}
        description={t('automate.editorDescription')}
        submitLabel={editingId ? t('common.saveChanges') : t('common.create')}
        onSubmit={() => void save()}
        onCancel={() => {
          setDialogOpen(false);
          setEditingId(null);
        }}
      >
        <FormField label={t('common.name')} required>
          <FormInput
            placeholder={t('automate.namePlaceholder')}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </FormField>
        <FormField label={t('automate.trigger')}>
          <FormSelect
            value={form.kind}
            onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as 'schedule' | 'event' }))}
          >
            <option value="schedule">{t('automate.triggerSchedule')}</option>
            <option value="event">{t('automate.triggerEvent')}</option>
          </FormSelect>
        </FormField>
        {form.kind === 'schedule' ? (
          <>
            <FormField label={t('automate.cron')} hint={t('automate.cronHint')}>
              <FormInput
                placeholder="0 9 * * 1-5"
                value={form.cron}
                onChange={(e) => setForm((f) => ({ ...f, cron: e.target.value }))}
              />
            </FormField>
            <FormField label={t('automate.timezone')}>
              <FormInput
                placeholder="UTC"
                value={form.timezone}
                onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
              />
            </FormField>
          </>
        ) : (
          <>
            <FormField label={t('automate.eventSource')}>
              <FormSelect
                value={form.sourceType}
                onChange={(e) => setForm((f) => ({ ...f, sourceType: e.target.value }))}
              >
                <option value="github">GitHub</option>
                <option value="custom">{t('common.custom')}</option>
              </FormSelect>
            </FormField>
            <FormField label={t('automate.triggerFilter')} hint={t('automate.triggerFilterHint')}>
              <FormTextarea
                className="min-h-20 font-mono text-xs"
                placeholder="{}"
                value={form.triggerFilter}
                onChange={(e) => setForm((f) => ({ ...f, triggerFilter: e.target.value }))}
              />
            </FormField>
          </>
        )}
        <FormField label={t('automate.prompt')} required hint={t('automate.promptHint')}>
          <FormTextarea
            placeholder={t('automate.promptPlaceholder')}
            value={form.prompt}
            onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
          />
        </FormField>
      </SettingsInlineEditor>

      <section className="mb-8">
        <SectionHeading title={t('automate.active')} count={active.length} />
        {active.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('automate.noActive')}</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {active.map((a) => (
              <AutomationCard
                key={a.id}
                automation={a}
                onRun={() => void settingsApi.triggerAutomation(a.id)}
                onToggle={() =>
                  void settingsApi.updateAutomation(a.id, { enabled: !a.enabled }).then(load)
                }
                onEdit={() => openEdit(a)}
                onDelete={() => {
                  if (confirm(t('automate.confirmDelete'))) void settingsApi.deleteAutomation(a.id).then(load);
                }}
                onSelect={() => setDetailId(a.id)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="mb-10">
        <SectionHeading title={t('automate.inactive')} count={inactive.length} />
        {inactive.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('automate.noInactive')}</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {inactive.map((a) => (
              <AutomationCard
                key={a.id}
                automation={a}
                onRun={() => void settingsApi.triggerAutomation(a.id)}
                onToggle={() =>
                  void settingsApi.updateAutomation(a.id, { enabled: !a.enabled }).then(load)
                }
                onEdit={() => openEdit(a)}
                onDelete={() => {
                  if (confirm(t('automate.confirmDelete'))) void settingsApi.deleteAutomation(a.id).then(load);
                }}
                onSelect={() => setDetailId(a.id)}
              />
            ))}
          </div>
        )}
      </section>

      {detail && (
        <section className="border-border mb-10 rounded-xl border p-4">
          <h3 className="mb-2 font-medium">{t('automate.details', { name: detail.name })}</h3>
          <pre className="bg-muted mb-3 whitespace-pre-wrap rounded-lg p-3 text-xs">{detail.prompt}</pre>
          {detail.kind === 'event' && (
            <pre className="bg-muted mb-3 rounded-lg p-3 text-xs">
              {JSON.stringify(detail.triggerFilter ?? {}, null, 2)}
            </pre>
          )}
          <SectionHeading title={t('automate.recentRuns')} count={runs.length} />
          <div className="flex flex-col gap-1.5">
            {runs.length === 0 && (
              <p className="text-muted-foreground text-xs">{t('automate.noRuns')}</p>
            )}
            {runs.slice(0, 5).map((run) => (
              <button
                key={run.id}
                type="button"
                onClick={() => void openRunThread(run.threadId)}
                className="hover:bg-accent/40 text-muted-foreground flex items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors"
                title={t('automate.openRunConversation')}
              >
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[10px] font-medium uppercase',
                    run.status === 'done' && 'bg-emerald-500/15 text-emerald-600',
                    run.status === 'failed' && 'bg-destructive/15 text-destructive',
                    run.status === 'running' && 'bg-blue-500/15 text-blue-600',
                    run.status === 'queued' && 'bg-muted text-muted-foreground',
                  )}
                >
                  {t(`automate.runStatus.${run.status}`)}
                </span>
                <span>{new Date(run.startedAt).toLocaleString()}</span>
                <span className="text-primary ml-auto underline">{t('common.open')}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="mb-8">
        <SectionHeading title={t('automate.templatesTitle')} />
        <div className="grid gap-3 md:grid-cols-2">
          {TEMPLATES.slice(0, 1).map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => applyTemplate(template)}
              className="border-border bg-card hover:bg-accent/20 group rounded-xl border p-4 text-left transition-colors"
            >
              <div className="mb-3 flex items-start justify-between">
                <div className="bg-muted flex size-9 items-center justify-center rounded-lg text-[10px] font-bold">
                  {template.icon}
                </div>
                <Plus className="text-muted-foreground size-4 opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
              <div className="text-muted-foreground mb-1 text-[11px] font-medium">{t(template.categoryKey)}</div>
              <div className="mb-2 font-medium">{t(template.nameKey)}</div>
              <p className="text-muted-foreground text-xs leading-relaxed">{t(template.descriptionKey)}</p>
            </button>
          ))}
        </div>
      </section>

      <section className="border-border border-t pt-6">
        <SectionHeading title={t('automate.webhooks')} count={webhooks.length} />
        <div className="mb-3 flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setHookError(null);
              void settingsApi
                .createWebhook('github')
                .then((r) => {
                  setCreatedHook({ url: r.endpoint.url, secret: r.secret, sourceType: 'github' });
                  void load();
                })
                .catch((err) => setHookError(String(err)));
            }}
          >
            {t('automate.addGithubWebhook')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setHookError(null);
              void settingsApi
                .createWebhook('custom')
                .then((r) => {
                  setCreatedHook({ url: r.endpoint.url, secret: r.secret, sourceType: 'custom' });
                  void load();
                })
                .catch((err) => setHookError(String(err)));
            }}
          >
            {t('automate.addCustomWebhook')}
          </Button>
        </div>
        {hookError ? (
          <p className="text-destructive mb-3 text-sm">{hookError}</p>
        ) : null}
        {createdHook && (
          <div className="border-amber-500/40 bg-amber-500/10 mb-3 rounded-lg border p-3 text-sm">
            <div className="mb-2 flex items-center justify-between gap-2">
              <strong>{t('automate.secretShownOnce')}</strong>
              <button
                type="button"
                className="text-xs underline"
                onClick={() => setCreatedHook(null)}
              >
                {t('common.dismiss')}
              </button>
            </div>
            <code className="mb-3 block break-all text-xs">{createdHook.secret}</code>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-muted-foreground text-xs">{t('automate.testWithCurl')}</span>
              <button
                type="button"
                className="text-xs underline"
                onClick={() => void navigator.clipboard?.writeText(buildWebhookCurl(createdHook))}
              >
                {t('common.copy')}
              </button>
            </div>
            <pre className="bg-background overflow-x-auto rounded-md p-3 text-[11px] leading-relaxed">
              {buildWebhookCurl(createdHook)}
            </pre>
          </div>
        )}
        {webhooks.map((w) => (
          <div key={w.id} className="border-border mb-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
            <code className="min-w-0 flex-1 truncate text-xs">{w.url}</code>
            <span className="text-muted-foreground text-xs">{w.sourceType}</span>
            <button
              type="button"
              className="text-xs underline"
              onClick={() =>
                void navigator.clipboard?.writeText(
                  buildWebhookCurl({ url: w.url, secret: '<SECRET>', sourceType: w.sourceType }),
                )
              }
            >
              {t('automate.copyCurl')}
            </button>
            <button
              type="button"
              className="text-destructive shrink-0 text-xs underline"
              onClick={() => {
                if (!confirm(t('automate.confirmDeleteWebhook'))) return;
                void settingsApi
                  .deleteWebhook(w.id)
                  .then(load)
                  .catch((err) => setHookError(String(err)));
              }}
            >
              {t('common.delete')}
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}
