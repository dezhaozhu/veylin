import { useCallback, useEffect, useState } from 'react';
import type { Rule } from '@/hooks/settings/api';
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

export function RulesSettingsScreen() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [query, setQuery] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [form, setForm] = useState({
    name: '',
    content: '',
    trigger: 'always' as 'always' | 'keyword',
    keywords: '',
    enabled: true,
  });

  const load = useCallback(async () => {
    const data = await settingsApi.getRules();
    setRules(data.rules);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const q = query.trim().toLowerCase();
  const filtered = rules.filter(
    (r) =>
      !q ||
      r.name.toLowerCase().includes(q) ||
      r.content.toLowerCase().includes(q) ||
      r.keywords.some((k) => k.toLowerCase().includes(q)),
  );

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', content: '', trigger: 'always', keywords: '', enabled: true });
    setDialogOpen(true);
  };

  const openEdit = (rule: Rule) => {
    setEditing(rule);
    setForm({
      name: rule.name,
      content: rule.content,
      trigger: rule.trigger,
      keywords: rule.keywords.join(', '),
      enabled: rule.enabled,
    });
    setDialogOpen(true);
  };

  const save = async () => {
    if (!form.name.trim() || !form.content.trim()) return;
    const body = {
      name: form.name,
      content: form.content,
      trigger: form.trigger,
      keywords: form.keywords
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean),
      enabled: form.enabled,
    };
    if (editing) await settingsApi.updateRule(editing.id, body);
    else await settingsApi.createRule(body);
    setDialogOpen(false);
    await load();
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Rules"
        description="Custom instructions injected into the system prompt — always, or when keywords appear in the user message."
        action={<PrimaryActionButton onClick={openCreate}>Add rule</PrimaryActionButton>}
      />

      <PageSearchBar value={query} onChange={setQuery} placeholder="Search rules…" />

      <SettingsInlineEditor
        open={dialogOpen}
        title={editing ? 'Edit rule' : 'Add rule'}
        description="Rules are prepended to the system prompt when their trigger matches."
        submitLabel={editing ? 'Save changes' : 'Add rule'}
        onSubmit={() => void save()}
        onCancel={() => setDialogOpen(false)}
      >
        <FormField label="Name" required>
          <FormInput
            placeholder="e.g. safety-checklist"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </FormField>
        <FormField label="Content" required hint="Instruction text injected into the system prompt.">
          <FormTextarea
            placeholder="Always verify schedule conflicts before proposing changes…"
            value={form.content}
            onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
          />
        </FormField>
        <FormField label="Trigger">
          <FormSelect
            value={form.trigger}
            onChange={(e) =>
              setForm((f) => ({ ...f, trigger: e.target.value as 'always' | 'keyword' }))
            }
          >
            <option value="always">Always</option>
            <option value="keyword">Keyword</option>
          </FormSelect>
        </FormField>
        {form.trigger === 'keyword' && (
          <FormField label="Keywords" hint="Comma-separated; rule applies when any keyword appears in the user message.">
            <FormInput
              placeholder="schedule, risk, overdue"
              value={form.keywords}
              onChange={(e) => setForm((f) => ({ ...f, keywords: e.target.value }))}
            />
          </FormField>
        )}
      </SettingsInlineEditor>

      <SectionHeading title="All rules" count={filtered.length} />

      <div className="flex flex-col gap-2">
        {filtered.map((rule) => (
          <div
            key={rule.id}
            className="border-border bg-card flex items-center gap-3 rounded-xl border px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <div className="font-medium">{rule.name}</div>
              <div className="text-muted-foreground text-xs">
                {rule.trigger}
                {rule.trigger === 'keyword' && rule.keywords.length > 0
                  ? ` · ${rule.keywords.join(', ')}`
                  : ''}
              </div>
            </div>
            <button type="button" className="text-xs underline" onClick={() => openEdit(rule)}>
              Edit
            </button>
            <button
              type="button"
              className="text-destructive text-xs underline"
              onClick={() => {
                if (confirm('Delete rule?')) void settingsApi.deleteRule(rule.id).then(load);
              }}
            >
              Delete
            </button>
            <SettingsSwitch
              checked={rule.enabled}
              onChange={(on) => void settingsApi.updateRule(rule.id, { enabled: on }).then(load)}
              label={`Toggle ${rule.name}`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
