import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAui } from '@assistant-ui/store';
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
    name: 'PR triage digest',
    category: 'Code review',
    icon: 'GH',
    description: 'Summarize open pull requests and flag items that need attention.',
    prompt:
      'Review open pull requests from the last 24 hours. Summarize risk, reviewers, and blockers. Post a concise digest.',
  },
  {
    id: 'security-pass',
    name: 'Nightly security pass',
    category: 'Security',
    icon: 'GH',
    description: 'Scan dependencies and surface CVEs before the next standup.',
    prompt:
      'Run a security review of dependencies changed in the last day. List CVEs, severity, and recommended actions.',
  },
  {
    id: 'slack-digest',
    name: 'Slack standup digest',
    category: 'Reporting',
    icon: 'SL',
    description: 'Compile engineering updates and post them to your team channel.',
    prompt:
      'Prepare a weekday standup digest from recent repo activity and open tasks. Format for Slack.',
  },
  {
    id: 'incident-hook',
    name: 'Incident webhook summary',
    category: 'Operations',
    icon: 'WH',
    description: 'React to incident webhooks and produce an actionable summary.',
    prompt:
      'When an incident webhook fires, summarize impact, affected services, and recommended next steps.',
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
  const scheduleLabel =
    automation.kind === 'schedule'
      ? automation.cron ?? 'Scheduled'
      : automation.sourceType === 'github'
        ? 'Runs on GitHub events'
        : 'Event-driven';

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
            aria-label="Edit"
          >
            Edit
          </button>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground rounded p-1"
            onClick={onDelete}
            aria-label="Delete"
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
        <MetaPill icon={Tag}>{automation.kind}</MetaPill>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="rounded-lg"
          onClick={onRun}
          disabled={!automation.enabled}
          title={automation.enabled ? 'Run now' : 'Enable the automation to run it'}
        >
          <Play className="mr-1.5 size-3.5" />
          Run now
        </Button>
        <Button size="sm" variant="ghost" className="rounded-lg text-xs" onClick={onToggle}>
          {automation.enabled ? 'Disable' : 'Enable'}
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
        alert('Unable to open this run yet. Try again after it appears in the sidebar.');
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
      alert('Trigger filter must be valid JSON');
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
      name: template.name,
      prompt: template.prompt,
      kind: template.id === 'incident-hook' ? 'event' : 'schedule',
      sourceType: template.id === 'incident-hook' ? 'github' : 'cron',
    });
    setDialogOpen(true);
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Automations"
        description="View active and inactive automations, search by metadata, and inspect read-only details."
        action={<PrimaryActionButton onClick={openCreate}>Add Automation</PrimaryActionButton>}
      />

      <PageSearchBar value={query} onChange={setQuery} placeholder="Search automations…" />

      <SettingsInlineEditor
        open={dialogOpen}
        title={editingId ? 'Edit automation' : 'Add automation'}
        description="Run an agent prompt on a schedule or in response to an event."
        submitLabel={editingId ? 'Save changes' : 'Create'}
        onSubmit={() => void save()}
        onCancel={() => {
          setDialogOpen(false);
          setEditingId(null);
        }}
      >
        <FormField label="Name" required>
          <FormInput
            placeholder="e.g. Nightly PR digest"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </FormField>
        <FormField label="Trigger">
          <FormSelect
            value={form.kind}
            onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as 'schedule' | 'event' }))}
          >
            <option value="schedule">Schedule (cron)</option>
            <option value="event">Event-driven</option>
          </FormSelect>
        </FormField>
        {form.kind === 'schedule' ? (
          <>
            <FormField label="Cron" hint="Standard 5-field cron, e.g. 0 9 * * 1-5 (weekdays 9am).">
              <FormInput
                placeholder="0 9 * * 1-5"
                value={form.cron}
                onChange={(e) => setForm((f) => ({ ...f, cron: e.target.value }))}
              />
            </FormField>
            <FormField label="Timezone">
              <FormInput
                placeholder="UTC"
                value={form.timezone}
                onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
              />
            </FormField>
          </>
        ) : (
          <>
            <FormField label="Event source">
              <FormSelect
                value={form.sourceType}
                onChange={(e) => setForm((f) => ({ ...f, sourceType: e.target.value }))}
              >
                <option value="github">GitHub</option>
                <option value="custom">Custom</option>
              </FormSelect>
            </FormField>
            <FormField
              label="Trigger filter"
              hint='Optional JSON; matched against the event payload, e.g. {"event":"github.push"}'
            >
              <FormTextarea
                className="min-h-20 font-mono text-xs"
                placeholder="{}"
                value={form.triggerFilter}
                onChange={(e) => setForm((f) => ({ ...f, triggerFilter: e.target.value }))}
              />
            </FormField>
          </>
        )}
        <FormField label="Prompt" required hint="The instruction the agent runs each time.">
          <FormTextarea
            placeholder="Summarize open pull requests and flag blockers…"
            value={form.prompt}
            onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
          />
        </FormField>
      </SettingsInlineEditor>

      <section className="mb-8">
        <SectionHeading title="Active" count={active.length} />
        {active.length === 0 ? (
          <p className="text-muted-foreground text-sm">No active automations.</p>
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
                  if (confirm('Delete automation?')) void settingsApi.deleteAutomation(a.id).then(load);
                }}
                onSelect={() => setDetailId(a.id)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="mb-10">
        <SectionHeading title="Inactive" count={inactive.length} />
        {inactive.length === 0 ? (
          <p className="text-muted-foreground text-sm">No inactive automations.</p>
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
                  if (confirm('Delete automation?')) void settingsApi.deleteAutomation(a.id).then(load);
                }}
                onSelect={() => setDetailId(a.id)}
              />
            ))}
          </div>
        )}
      </section>

      {detail && (
        <section className="border-border mb-10 rounded-xl border p-4">
          <h3 className="mb-2 font-medium">Details · {detail.name}</h3>
          <pre className="bg-muted mb-3 whitespace-pre-wrap rounded-lg p-3 text-xs">{detail.prompt}</pre>
          {detail.kind === 'event' && (
            <pre className="bg-muted mb-3 rounded-lg p-3 text-xs">
              {JSON.stringify(detail.triggerFilter ?? {}, null, 2)}
            </pre>
          )}
          <SectionHeading title="Recent runs" count={runs.length} />
          <div className="flex flex-col gap-1.5">
            {runs.length === 0 && (
              <p className="text-muted-foreground text-xs">No runs yet.</p>
            )}
            {runs.slice(0, 5).map((run) => (
              <button
                key={run.id}
                type="button"
                onClick={() => void openRunThread(run.threadId)}
                className="hover:bg-accent/40 text-muted-foreground flex items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors"
                title="Open this run's conversation"
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
                  {run.status}
                </span>
                <span>{new Date(run.startedAt).toLocaleString()}</span>
                <span className="text-primary ml-auto underline">Open</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="mb-8">
        <SectionHeading
          title="Start from a proven workflow"
          trailing={
            <span className="text-muted-foreground text-xs">
              Pre-filled prompts you can launch immediately
            </span>
          }
        />
        <div className="grid gap-3 md:grid-cols-2">
          {TEMPLATES.slice(0, 1).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => applyTemplate(t)}
              className="border-border bg-card hover:bg-accent/20 group rounded-xl border p-4 text-left transition-colors"
            >
              <div className="mb-3 flex items-start justify-between">
                <div className="bg-muted flex size-9 items-center justify-center rounded-lg text-[10px] font-bold">
                  {t.icon}
                </div>
                <Plus className="text-muted-foreground size-4 opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
              <div className="text-muted-foreground mb-1 text-[11px] font-medium">{t.category}</div>
              <div className="mb-2 font-medium">{t.name}</div>
              <p className="text-muted-foreground text-xs leading-relaxed">{t.description}</p>
            </button>
          ))}
        </div>
      </section>

      <section className="border-border border-t pt-6">
        <SectionHeading title="Webhook endpoints" count={webhooks.length} />
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
            + GitHub webhook
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
            + Custom webhook
          </Button>
        </div>
        {hookError ? (
          <p className="text-destructive mb-3 text-sm">{hookError}</p>
        ) : null}
        {createdHook && (
          <div className="border-amber-500/40 bg-amber-500/10 mb-3 rounded-lg border p-3 text-sm">
            <div className="mb-2 flex items-center justify-between gap-2">
              <strong>Secret (shown once — copy now)</strong>
              <button
                type="button"
                className="text-xs underline"
                onClick={() => setCreatedHook(null)}
              >
                Dismiss
              </button>
            </div>
            <code className="mb-3 block break-all text-xs">{createdHook.secret}</code>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-muted-foreground text-xs">Test it with curl:</span>
              <button
                type="button"
                className="text-xs underline"
                onClick={() => void navigator.clipboard?.writeText(buildWebhookCurl(createdHook))}
              >
                Copy
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
              Copy curl
            </button>
            <button type="button" className="text-destructive text-xs underline" onClick={() => void settingsApi.deleteWebhook(w.id).then(load)}>
              Delete
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}
