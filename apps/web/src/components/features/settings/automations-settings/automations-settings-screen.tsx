import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAui } from '@assistant-ui/store';
import { useTranslation } from 'react-i18next';
import {
  Check,
  Clock,
  Copy,
  FolderGit2,
  Play,
  Tag,
  Workflow,
} from 'lucide-react';
import type { Automation, AutomationRun, WebhookEndpoint } from '@/hooks/settings/api';
import { DEFAULT_AGENT_ID } from '@veylin/shared';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  FormField,
  FormInput,
  FormSelect,
  FormTextarea,
  SettingsFormDialog,
} from '../settings-form-dialog';
import {
  SettingsDeleteButton,
  SettingsDeleteDialog,
  SettingsEditButton,
} from '../settings-item-actions';
import { cn } from '@/lib/utils';
import { copyToClipboard } from '@/lib/copy-to-clipboard';
import { humanizeCronExpression } from '@/lib/cron-expression';
import {
  SettingsConnectedList,
  SettingsListIcon,
  SettingsListRow,
} from '../settings-list';

const TEMPLATES = [
  {
    id: 'pr-triage',
    nameKey: 'automate.templates.prTriage.name',
    descriptionKey: 'automate.templates.prTriage.description',
    promptKey: 'automate.templates.prTriage.prompt',
  },
  {
    id: 'security-pass',
    nameKey: 'automate.templates.securityPass.name',
    descriptionKey: 'automate.templates.securityPass.description',
    promptKey: 'automate.templates.securityPass.prompt',
  },
  {
    id: 'slack-digest',
    nameKey: 'automate.templates.slackDigest.name',
    descriptionKey: 'automate.templates.slackDigest.description',
    promptKey: 'automate.templates.slackDigest.prompt',
  },
  {
    id: 'incident-hook',
    nameKey: 'automate.templates.incidentHook.name',
    descriptionKey: 'automate.templates.incidentHook.description',
    promptKey: 'automate.templates.incidentHook.prompt',
  },
] as const;

type CreatedHook = { url: string; secret: string; signatureHeader: string };

function resolveSignatureHeader(endpoint: Pick<WebhookEndpoint, 'signatureHeader' | 'source'>): string {
  if (endpoint.signatureHeader) return endpoint.signatureHeader;
  return endpoint.source === 'github' ? 'X-Hub-Signature-256' : 'X-Signature-256';
}

function buildWebhookCurl({ url, secret, signatureHeader }: CreatedHook): string {
  const sigValue = signatureHeader === 'X-Hub-Signature-256' ? 'sha256=$SIG' : '$SIG';
  return [
    `SECRET='${secret}'`,
    `BODY='{"event":"test"}'`,
    `SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')`,
    `curl -X POST '${url}' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -H "${signatureHeader}: ${sigValue}" \\`,
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
    automation.kind === 'cron'
      ? (automation.cron
          ? humanizeCronExpression(automation.cron, t) ?? automation.cron
          : t('automate.scheduled'))
      : automation.sourceType === 'github'
        ? t('automate.runsOnGithubEvents')
        : automation.eventOn
          ? String(automation.eventOn)
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
        <div className="flex shrink-0 items-center gap-0.5 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
          <SettingsEditButton onClick={onEdit} />
          <SettingsDeleteButton onClick={onDelete} />
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
  kind: 'cron' as 'cron' | 'event',
  agentId: DEFAULT_AGENT_ID,
  prompt: '',
  cron: '0 9 * * 1-5',
  timezone: 'UTC',
  sourceType: 'github',
  eventOn: '',
  eventFilter: '',
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
  const [copiedCurlId, setCopiedCurlId] = useState<string | null>(null);
  const [copiedSecretCurl, setCopiedSecretCurl] = useState(false);
  const [hookError, setHookError] = useState<string | null>(null);
  const [deleteWebhookTarget, setDeleteWebhookTarget] = useState<WebhookEndpoint | null>(null);
  const [deletingWebhook, setDeletingWebhook] = useState(false);
  const [deleteAutomationTarget, setDeleteAutomationTarget] = useState<Automation | null>(null);
  const [deletingAutomation, setDeletingAutomation] = useState(false);
  const [githubHookDialogOpen, setGithubHookDialogOpen] = useState(false);
  const [githubHookName, setGithubHookName] = useState('GitHub');
  const [creatingGithubHook, setCreatingGithubHook] = useState(false);
  const [customHookDialogOpen, setCustomHookDialogOpen] = useState(false);
  const [creatingCustomHook, setCreatingCustomHook] = useState(false);
  const [editHookDialogOpen, setEditHookDialogOpen] = useState(false);
  const [editingWebhook, setEditingWebhook] = useState<WebhookEndpoint | null>(null);
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [editHookForm, setEditHookForm] = useState({
    name: '',
    eventKeyExpr: 'type',
    signatureHeader: 'X-Signature-256',
  });
  const [customHookForm, setCustomHookForm] = useState({
    name: '',
    source: '',
    eventKeyExpr: 'type',
    signatureHeader: 'X-Signature-256',
  });
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const cronSummary = useMemo(
    () => (form.kind === 'cron' ? humanizeCronExpression(form.cron, t) : null),
    [form.kind, form.cron, t],
  );

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

  const confirmDeleteWebhook = useCallback(async () => {
    if (!deleteWebhookTarget || deletingWebhook) return;
    setDeletingWebhook(true);
    setHookError(null);
    try {
      await settingsApi.deleteWebhook(deleteWebhookTarget.id);
      setDeleteWebhookTarget(null);
      await load();
    } catch (err) {
      setHookError(String(err));
    } finally {
      setDeletingWebhook(false);
    }
  }, [deleteWebhookTarget, deletingWebhook, load]);

  const confirmDeleteAutomation = useCallback(async () => {
    if (!deleteAutomationTarget || deletingAutomation) return;
    setDeletingAutomation(true);
    try {
      await settingsApi.deleteAutomation(deleteAutomationTarget.id);
      setDeleteAutomationTarget(null);
      if (detailId === deleteAutomationTarget.id) setDetailId(null);
      await load();
    } finally {
      setDeletingAutomation(false);
    }
  }, [deleteAutomationTarget, deletingAutomation, detailId, load]);

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
      eventOn: Array.isArray(automation.eventOn)
        ? automation.eventOn.join(', ')
        : (automation.eventOn ?? ''),
      eventFilter: automation.eventFilter ?? '',
    });
    setDialogOpen(true);
  };

  const save = async () => {
    if (!form.name.trim() || !form.prompt.trim()) return;
    const eventOnPatterns = form.eventOn
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const body = {
      name: form.name,
      kind: form.kind,
      agentId: form.agentId,
      prompt: form.prompt,
      cron: form.kind === 'cron' ? form.cron : undefined,
      timezone: form.timezone,
      sourceType: form.kind === 'event' ? form.sourceType : 'cron',
      eventOn:
        form.kind === 'event' && eventOnPatterns.length === 1
          ? eventOnPatterns[0]
          : form.kind === 'event' && eventOnPatterns.length > 1
            ? eventOnPatterns
            : undefined,
      eventFilter: form.kind === 'event' && form.eventFilter.trim() ? form.eventFilter.trim() : undefined,
    };
    if (editingId) await settingsApi.updateAutomation(editingId, body);
    else await settingsApi.createAutomation(body);
    setDialogOpen(false);
    setEditingId(null);
    await load();
  };

  const showCreatedHookResult = (r: { endpoint: WebhookEndpoint; secret: string | null }) => {
    if (r.secret) {
      setCreatedHook({
        url: r.endpoint.url,
        secret: r.secret,
        signatureHeader: resolveSignatureHeader({
          ...r.endpoint,
          source: r.endpoint.source ?? 'github',
        }),
      });
    }
  };

  const openGithubHookDialog = () => {
    setHookError(null);
    setGithubHookName('GitHub');
    setGithubHookDialogOpen(true);
  };

  const openCustomHookDialog = () => {
    setHookError(null);
    setCustomHookForm({
      name: '',
      source: '',
      eventKeyExpr: 'type',
      signatureHeader: 'X-Signature-256',
    });
    setCustomHookDialogOpen(true);
  };

  const openEditWebhook = (webhook: WebhookEndpoint) => {
    setHookError(null);
    setEditingWebhook(webhook);
    setEditHookForm({
      name: webhook.name,
      eventKeyExpr: webhook.eventKeyExpr || 'type',
      signatureHeader: resolveSignatureHeader(webhook),
    });
    setEditHookDialogOpen(true);
  };

  const saveEditWebhook = async () => {
    if (!editingWebhook || savingWebhook || !editHookForm.name.trim()) return;
    setSavingWebhook(true);
    setHookError(null);
    try {
      await settingsApi.updateWebhook(editingWebhook.id, {
        name: editHookForm.name.trim(),
        eventKeyExpr: editHookForm.eventKeyExpr.trim() || 'type',
        signatureHeader: editHookForm.signatureHeader.trim() || 'X-Signature-256',
      });
      setEditHookDialogOpen(false);
      setEditingWebhook(null);
      await load();
    } catch (err) {
      setHookError(String(err));
    } finally {
      setSavingWebhook(false);
    }
  };

  const flashCopiedCurl = useCallback((id: string) => {
    setCopiedCurlId(id);
    window.setTimeout(() => {
      setCopiedCurlId((current) => (current === id ? null : current));
    }, 2000);
  }, []);

  const handleCopyListCurl = useCallback(
    async (webhook: WebhookEndpoint) => {
      const ok = await copyToClipboard(
        buildWebhookCurl({
          url: webhook.url,
          secret: '<SECRET>',
          signatureHeader: resolveSignatureHeader(webhook),
        }),
      );
      if (ok) flashCopiedCurl(webhook.id);
    },
    [flashCopiedCurl],
  );

  const handleCopySecretCurl = useCallback(async () => {
    if (!createdHook) return;
    const ok = await copyToClipboard(buildWebhookCurl(createdHook));
    if (ok) {
      setCopiedSecretCurl(true);
      window.setTimeout(() => setCopiedSecretCurl(false), 2000);
    }
  }, [createdHook]);

  const createGithubHook = async () => {
    if (creatingGithubHook) return;
    setCreatingGithubHook(true);
    setHookError(null);
    try {
      const r = await settingsApi.createWebhook({
        preset: 'github',
        name: githubHookName.trim() || 'GitHub',
      });
      setGithubHookDialogOpen(false);
      showCreatedHookResult(r);
      await load();
    } catch (err) {
      setHookError(String(err));
    } finally {
      setCreatingGithubHook(false);
    }
  };

  const createCustomHook = async () => {
    if (creatingCustomHook || !customHookForm.name.trim() || !customHookForm.source.trim()) return;
    setCreatingCustomHook(true);
    setHookError(null);
    try {
      const r = await settingsApi.createWebhook({
        name: customHookForm.name.trim(),
        source: customHookForm.source.trim(),
        eventKeyExpr: customHookForm.eventKeyExpr.trim() || 'type',
        signatureHeader: customHookForm.signatureHeader.trim() || 'X-Signature-256',
      });
      setCustomHookDialogOpen(false);
      showCreatedHookResult(r);
      await load();
    } catch (err) {
      setHookError(String(err));
    } finally {
      setCreatingCustomHook(false);
    }
  };

  const applyTemplate = (template: (typeof TEMPLATES)[number]) => {
    setEditingId(null);
    setForm({
      ...EMPTY_FORM,
      name: t(template.nameKey),
      prompt: t(template.promptKey),
      kind: template.id === 'incident-hook' ? 'event' : 'cron',
      sourceType: template.id === 'incident-hook' ? 'github' : 'cron',
      eventOn: template.id === 'incident-hook' ? 'pull_request.opened' : '',
      eventFilter: '',
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

      <SettingsFormDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingId(null);
        }}
        title={editingId ? t('automate.editTitle') : t('automate.addTitle')}
        description={t('automate.editorDescription')}
        submitLabel={editingId ? t('common.saveChanges') : t('common.create')}
        onSubmit={() => void save()}
        onCancel={() => setEditingId(null)}
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
            onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as 'cron' | 'event' }))}
          >
            <option value="cron">{t('automate.triggerSchedule')}</option>
            <option value="event">{t('automate.triggerEvent')}</option>
          </FormSelect>
        </FormField>
        {form.kind === 'cron' ? (
          <>
            <FormField label={t('automate.cron')} hint={t('automate.cronHint')}>
              <FormInput
                className="font-mono text-sm tracking-wide"
                placeholder="0 9 * * 1-5"
                value={form.cron}
                onChange={(e) => setForm((f) => ({ ...f, cron: e.target.value }))}
              />
              {cronSummary && (
                <span className="text-foreground/80 text-xs font-medium">{cronSummary}</span>
              )}
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
            <FormField label={t('automate.eventSource')} hint={t('automate.eventSourceHint')}>
              <FormInput
                placeholder="github"
                value={form.sourceType}
                onChange={(e) => setForm((f) => ({ ...f, sourceType: e.target.value }))}
              />
            </FormField>
            <FormField label={t('automate.eventOn')} hint={t('automate.eventOnHint')}>
              <FormInput
                placeholder="pull_request.opened"
                value={form.eventOn}
                onChange={(e) => setForm((f) => ({ ...f, eventOn: e.target.value }))}
              />
            </FormField>
            <FormField label={t('automate.eventFilter')} hint={t('automate.eventFilterHint')}>
              <FormTextarea
                className="min-h-20 font-mono text-xs"
                placeholder="glob(repository.full_name, 'org/*')"
                value={form.eventFilter}
                onChange={(e) => setForm((f) => ({ ...f, eventFilter: e.target.value }))}
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
      </SettingsFormDialog>

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
                onDelete={() => setDeleteAutomationTarget(a)}
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
                onDelete={() => setDeleteAutomationTarget(a)}
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
              {JSON.stringify(
                {
                  source: detail.sourceType,
                  on: detail.eventOn,
                  filter: detail.eventFilter,
                },
                null,
                2,
              )}
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
        <SectionHeading title={t('automate.templatesTitle')} count={TEMPLATES.length} />
        <SettingsConnectedList>
          {TEMPLATES.map((template) => (
            <SettingsListRow
              key={template.id}
              asButton
              onClick={() => applyTemplate(template)}
              icon={
                <SettingsListIcon>
                  <Workflow className="size-4" />
                </SettingsListIcon>
              }
              title={t(template.nameKey)}
              subtitle={t(template.descriptionKey)}
            />
          ))}
        </SettingsConnectedList>
      </section>

      <section className="border-border border-t pt-6">
        <SectionHeading title={t('automate.webhooks')} count={webhooks.length} />
        <div className="mb-3 flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={openGithubHookDialog}>
            {t('automate.addGithubWebhook')}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={openCustomHookDialog}>
            {t('automate.addCustomWebhook')}
          </Button>
        </div>
        {hookError ? (
          <p className="text-destructive mb-3 text-sm">{hookError}</p>
        ) : null}
        {webhooks.map((w) => (
          <div key={w.id} className="border-border mb-2 flex items-center gap-1 rounded-lg border px-3 py-2 text-sm">
            <div className="min-w-0 flex-1 truncate font-medium">{w.name}</div>
            <SettingsEditButton onClick={() => openEditWebhook(w)} />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="text-muted-foreground hover:text-foreground size-8 shrink-0"
              data-no-window-drag
              aria-label={t('automate.copyCurl')}
              onClick={() => void handleCopyListCurl(w)}
            >
              {copiedCurlId === w.id ? <Check className="size-4" /> : <Copy className="size-4" />}
            </Button>
            <SettingsDeleteButton onClick={() => {
                setHookError(null);
                setDeleteWebhookTarget(w);
              }} />
          </div>
        ))}
      </section>

      <SettingsFormDialog
        open={githubHookDialogOpen}
        onOpenChange={setGithubHookDialogOpen}
        title={t('automate.addGithubWebhookTitle')}
        description={t('automate.addGithubWebhookDescription')}
        submitLabel={t('common.create')}
        onSubmit={() => void createGithubHook()}
      >
        <FormField label={t('common.name')} required>
          <FormInput
            value={githubHookName}
            onChange={(e) => setGithubHookName(e.target.value)}
          />
        </FormField>
      </SettingsFormDialog>

      <SettingsFormDialog
        open={customHookDialogOpen}
        onOpenChange={setCustomHookDialogOpen}
        title={t('automate.addCustomWebhookTitle')}
        description={t('automate.addCustomWebhookDescription')}
        submitLabel={t('common.create')}
        onSubmit={() => void createCustomHook()}
      >
        <FormField label={t('common.name')} required>
          <FormInput
            value={customHookForm.name}
            onChange={(e) => setCustomHookForm((f) => ({ ...f, name: e.target.value }))}
          />
        </FormField>
        <FormField label={t('automate.webhookSource')} hint={t('automate.webhookSourceHint')} required>
          <FormInput
            placeholder="linear"
            value={customHookForm.source}
            onChange={(e) =>
              setCustomHookForm((f) => ({ ...f, source: e.target.value.toLowerCase() }))
            }
          />
        </FormField>
        <FormField label={t('automate.eventKeyExpr')} hint={t('automate.eventKeyExprHint')}>
          <FormInput
            value={customHookForm.eventKeyExpr}
            onChange={(e) => setCustomHookForm((f) => ({ ...f, eventKeyExpr: e.target.value }))}
          />
        </FormField>
        <FormField label={t('automate.signatureHeader')}>
          <FormInput
            value={customHookForm.signatureHeader}
            onChange={(e) =>
              setCustomHookForm((f) => ({ ...f, signatureHeader: e.target.value }))
            }
          />
        </FormField>
      </SettingsFormDialog>

      <SettingsFormDialog
        open={editHookDialogOpen}
        onOpenChange={(open) => {
          setEditHookDialogOpen(open);
          if (!open) setEditingWebhook(null);
        }}
        title={t('automate.editWebhookTitle')}
        description={t('automate.editWebhookDescription')}
        submitLabel={t('common.saveChanges')}
        onSubmit={() => void saveEditWebhook()}
        onCancel={() => setEditingWebhook(null)}
      >
        <FormField label={t('automate.webhookSource')}>
          <FormInput value={editingWebhook?.source ?? ''} readOnly disabled />
        </FormField>
        <FormField label={t('common.name')} required>
          <FormInput
            value={editHookForm.name}
            onChange={(e) => setEditHookForm((f) => ({ ...f, name: e.target.value }))}
          />
        </FormField>
        <FormField label={t('automate.eventKeyExpr')} hint={t('automate.eventKeyExprHint')}>
          <FormInput
            value={editHookForm.eventKeyExpr}
            onChange={(e) => setEditHookForm((f) => ({ ...f, eventKeyExpr: e.target.value }))}
          />
        </FormField>
        <FormField label={t('automate.signatureHeader')}>
          <FormInput
            value={editHookForm.signatureHeader}
            onChange={(e) =>
              setEditHookForm((f) => ({ ...f, signatureHeader: e.target.value }))
            }
          />
        </FormField>
      </SettingsFormDialog>

      <Dialog
        open={createdHook !== null}
        onOpenChange={(open) => !open && setCreatedHook(null)}
      >
        <DialogContent className="gap-0 p-0 sm:max-w-lg">
          <DialogHeader className="border-border space-y-1 border-b px-6 py-4 text-left">
            <DialogTitle className="text-base">{t('automate.secretShownOnce')}</DialogTitle>
          </DialogHeader>
          {createdHook ? (
            <div className="flex max-h-[min(70vh,32rem)] flex-col gap-3 overflow-y-auto px-6 py-4 text-sm">
              <code className="block break-all text-xs">{createdHook.secret}</code>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground text-xs">{t('automate.testWithCurl')}</span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="text-muted-foreground hover:text-foreground size-8 shrink-0"
                  data-no-window-drag
                  aria-label={t('common.copy')}
                  onClick={() => void handleCopySecretCurl()}
                >
                  {copiedSecretCurl ? <Check className="size-4" /> : <Copy className="size-4" />}
                </Button>
              </div>
              <pre className="bg-muted overflow-x-auto rounded-md p-3 text-[11px] leading-relaxed">
                {buildWebhookCurl(createdHook)}
              </pre>
            </div>
          ) : null}
          <DialogFooter className="border-border border-t px-6 py-4">
            <Button type="button" onClick={() => setCreatedHook(null)}>
              {t('common.dismiss')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SettingsDeleteDialog
        open={deleteAutomationTarget !== null}
        onOpenChange={(open) => !open && setDeleteAutomationTarget(null)}
        title={t('automate.deleteAutomationTitle')}
        description={t('automate.confirmDelete')}
        onConfirm={confirmDeleteAutomation}
        busy={deletingAutomation}
      />

      <SettingsDeleteDialog
        open={deleteWebhookTarget !== null}
        onOpenChange={(open) => !open && !deletingWebhook && setDeleteWebhookTarget(null)}
        title={t('automate.deleteWebhookTitle')}
        description={t('automate.confirmDeleteWebhook')}
        onConfirm={confirmDeleteWebhook}
        busy={deletingWebhook}
        busyLabel={t('automate.deletingWebhook')}
      />
    </div>
  );
}
