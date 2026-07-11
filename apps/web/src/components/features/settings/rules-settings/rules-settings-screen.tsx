import { useCallback, useEffect, useState } from 'react';
import { List } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Rule } from '@/hooks/settings/api';
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

function RuleRow({
  rule,
  onToggle,
  onEdit,
  onDelete,
}: {
  rule: Rule;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();

  return (
    <SettingsListRow
      icon={
        <SettingsListIcon statusDot={rule.enabled}>
          <List className="size-4" />
        </SettingsListIcon>
      }
      title={rule.name}
      subtitle={rule.content}
      subtitleClamp={2}
      menuItems={[
        {
          label: rule.enabled ? t('common.disable') : t('common.enable'),
          onClick: () => onToggle(!rule.enabled),
        },
        { label: t('common.edit'), onClick: onEdit },
        { label: t('common.delete'), onClick: onDelete, destructive: true },
      ]}
    />
  );
}

export function RulesSettingsScreen() {
  const { t } = useTranslation();
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Rule | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState({
    name: '',
    content: '',
    trigger: 'always' as 'always' | 'keyword',
    keywords: '',
    enabled: true,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await settingsApi.getRules();
      setRules(data.rules);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('customize.rulesPage.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

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

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await settingsApi.deleteRule(deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return <div className="text-muted-foreground text-sm">{t('customize.rulesPage.loading')}</div>;
  }

  if (loadError) {
    return (
      <div className="mx-auto flex max-w-4xl flex-col items-start gap-3">
        <p className="text-muted-foreground text-sm">{t('customize.rulesPage.loadFailed')}</p>
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
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={t('customize.rulesPage.title')}
        description={t('customize.rulesPage.description')}
        action={<PrimaryActionButton onClick={openCreate}>{t('customize.rulesPage.addRule')}</PrimaryActionButton>}
      />

      <PageSearchBar value={query} onChange={setQuery} placeholder={t('customize.rulesPage.searchPlaceholder')} />

      <SettingsFormDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditing(null);
        }}
        title={editing ? t('customize.rulesPage.editTitle') : t('customize.rulesPage.addTitle')}
        description={t('customize.rulesPage.editorDescription')}
        submitLabel={editing ? t('common.saveChanges') : t('customize.rulesPage.addRule')}
        onSubmit={() => void save()}
        onCancel={() => setEditing(null)}
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
      </SettingsFormDialog>

      <SectionHeading title={t('customize.rulesPage.allRules')} count={filtered.length} />

      {filtered.length > 0 ? (
        <SettingsConnectedList>
          {filtered.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              onToggle={(on) => void settingsApi.updateRule(rule.id, { enabled: on }).then(load)}
              onEdit={() => openEdit(rule)}
              onDelete={() => setDeleteTarget(rule)}
            />
          ))}
        </SettingsConnectedList>
      ) : null}

      <SettingsDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t('customize.rulesPage.deleteTitle')}
        description={t('customize.rulesPage.confirmDelete')}
        onConfirm={confirmDelete}
        busy={deleting}
      />
    </div>
  );
}
