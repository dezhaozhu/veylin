import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
    try {
      const saved = editing
        ? await settingsApi.updateRule(editing.id, body)
        : await settingsApi.createRule(body);
      setRules((prev) =>
        editing
          ? prev.map((rule) => (rule.id === saved.rule.id ? saved.rule : rule))
          : [saved.rule, ...prev],
      );
      setDialogOpen(false);
      setEditing(null);
      await load();
    } catch (err) {
      alert(t('customize.rulesPage.saveFailed', { error: err instanceof Error ? err.message : String(err) }));
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={t('customize.rulesPage.title')}
        description={t('customize.rulesPage.description')}
        action={<PrimaryActionButton onClick={openCreate}>{t('customize.rulesPage.addRule')}</PrimaryActionButton>}
      />

      <PageSearchBar value={query} onChange={setQuery} placeholder={t('customize.rulesPage.searchPlaceholder')} />

      <SettingsInlineEditor
        open={dialogOpen}
        title={editing ? t('customize.rulesPage.editTitle') : t('customize.rulesPage.addTitle')}
        description={t('customize.rulesPage.editorDescription')}
        submitLabel={editing ? t('common.saveChanges') : t('customize.rulesPage.addRule')}
        onSubmit={() => void save()}
        onCancel={() => setDialogOpen(false)}
      >
        <FormField label={t('common.name')} required>
          <FormInput
            placeholder={t('customize.rulesPage.namePlaceholder')}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </FormField>
        <FormField label={t('common.content')} required hint={t('customize.rulesPage.contentHint')}>
          <FormTextarea
            placeholder={t('customize.rulesPage.contentPlaceholder')}
            value={form.content}
            onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
          />
        </FormField>
        <FormField label={t('customize.rulesPage.trigger')}>
          <FormSelect
            value={form.trigger}
            onChange={(e) =>
              setForm((f) => ({ ...f, trigger: e.target.value as 'always' | 'keyword' }))
            }
          >
            <option value="always">{t('customize.rulesPage.triggerAlways')}</option>
            <option value="keyword">{t('customize.rulesPage.triggerKeyword')}</option>
          </FormSelect>
        </FormField>
        {form.trigger === 'keyword' && (
          <FormField label={t('customize.rulesPage.keywords')} hint={t('customize.rulesPage.keywordsHint')}>
            <FormInput
              placeholder={t('customize.rulesPage.keywordsPlaceholder')}
              value={form.keywords}
              onChange={(e) => setForm((f) => ({ ...f, keywords: e.target.value }))}
            />
          </FormField>
        )}
      </SettingsInlineEditor>

      <SectionHeading title={t('customize.rulesPage.allRules')} count={filtered.length} />

      <div className="flex flex-col gap-2">
        {filtered.map((rule) => (
          <div
            key={rule.id}
            className="border-border bg-card flex items-center gap-3 rounded-xl border px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <div className="font-medium">{rule.name}</div>
              <p className="text-muted-foreground mt-1 truncate text-sm">{rule.content}</p>
              <div className="text-muted-foreground text-xs">
                {rule.trigger === 'always' ? t('customize.rulesPage.triggerAlways') : t('customize.rulesPage.triggerKeyword')}
                {rule.trigger === 'keyword' && rule.keywords.length > 0
                  ? ` · ${rule.keywords.join(', ')}`
                  : ''}
              </div>
            </div>
            <button type="button" className="text-xs underline" onClick={() => openEdit(rule)}>
              {t('common.edit')}
            </button>
            <button
              type="button"
              className="text-destructive text-xs underline"
              onClick={() => {
                if (confirm(t('customize.rulesPage.confirmDelete'))) void settingsApi.deleteRule(rule.id).then(load);
              }}
            >
              {t('common.delete')}
            </button>
            <SettingsSwitch
              checked={rule.enabled}
              onChange={(on) => void settingsApi.updateRule(rule.id, { enabled: on }).then(load)}
              label={t('customize.rulesPage.toggle', { name: rule.name })}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
