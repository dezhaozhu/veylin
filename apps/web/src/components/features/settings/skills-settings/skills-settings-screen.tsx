import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SkillListItem } from '@/hooks/settings/api';
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
  FormTextarea,
  SettingsInlineEditor,
} from '../settings-form-dialog';
import { cn } from '@/lib/utils';

function SkillCard({
  skill,
  onToggle,
  onEdit,
  onDelete,
}: {
  skill: SkillListItem;
  onToggle: (enabled: boolean) => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="border-border bg-card flex items-start gap-3 rounded-xl border p-4">
      <div className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-lg text-xs font-bold">
        {skill.name.slice(0, 2).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{skill.name}</span>
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-[10px] font-medium uppercase',
              skill.source === 'bundled' ? 'bg-muted text-muted-foreground' : 'bg-blue-500/15 text-blue-600',
            )}
          >
            {t(`customize.skillsPage.source.${skill.source}`)}
          </span>
        </div>
        {skill.description && (
          <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{skill.description}</p>
        )}
        {skill.content && (
          <p className="text-muted-foreground mt-1 line-clamp-2 text-xs leading-relaxed">
            {skill.content}
          </p>
        )}
        {skill.triggers?.length > 0 && (
          <p className="text-muted-foreground mt-1 text-xs">
            {t('customize.skillsPage.triggers', { triggers: skill.triggers.join(', ') })}
          </p>
        )}
        {skill.source === 'custom' && (
          <div className="mt-2 flex gap-3">
            {onEdit && (
              <button type="button" className="text-xs underline" onClick={onEdit}>
                {t('common.edit')}
              </button>
            )}
            {onDelete && (
              <button type="button" className="text-destructive text-xs underline" onClick={onDelete}>
                {t('common.delete')}
              </button>
            )}
          </div>
        )}
      </div>
      <SettingsSwitch checked={skill.enabled} onChange={onToggle} label={t('customize.skillsPage.toggle', { name: skill.name })} />
    </div>
  );
}

export function SkillsSettingsScreen() {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<SkillListItem[]>([]);
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SkillListItem | null>(null);
  const [form, setForm] = useState({ name: '', description: '', content: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await settingsApi.getSkills();
      setSkills(data.skills);
      setDisabled(new Set(data.disabledSkills));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const q = query.trim().toLowerCase();
  const bundled = useMemo(
    () => skills.filter((s) => s.source === 'bundled' && (!q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))),
    [skills, q],
  );
  const custom = useMemo(
    () => skills.filter((s) => s.source === 'custom' && (!q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))),
    [skills, q],
  );

  const toggleBundled = async (name: string, enabled: boolean) => {
    const next = new Set(disabled);
    if (enabled) next.delete(name);
    else next.add(name);
    setDisabled(next);
    setSkills((prev) =>
      prev.map((s) => (s.name === name && s.source === 'bundled' ? { ...s, enabled } : s)),
    );
    await settingsApi.saveDisabledSkills([...next]);
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', description: '', content: '' });
    setDialogOpen(true);
  };

  const openEdit = (skill: SkillListItem) => {
    setEditing(skill);
    setForm({
      name: skill.name,
      description: skill.description,
      content: skill.content ?? '',
    });
    setDialogOpen(true);
  };

  const saveCustom = async () => {
    if (!form.name.trim() || !form.content.trim()) return;
    try {
      const saved = editing?.id
        ? await settingsApi.updateSkill(editing.id, form)
        : await settingsApi.createSkill(form);
      setSkills((prev) =>
        editing?.id
          ? prev.map((skill) =>
              skill.source === 'custom' && skill.id === saved.skill.id ? saved.skill : skill,
            )
          : [saved.skill, ...prev],
      );
      setDialogOpen(false);
      setEditing(null);
      await load();
    } catch (err) {
      alert(t('customize.skillsPage.saveFailed', { error: err instanceof Error ? err.message : String(err) }));
    }
  };

  if (loading) {
    return <div className="text-muted-foreground text-sm">{t('customize.skillsPage.loading')}</div>;
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={t('customize.skillsPage.title')}
        description={t('customize.skillsPage.description')}
        action={<PrimaryActionButton onClick={openCreate}>{t('customize.skillsPage.addCustom')}</PrimaryActionButton>}
      />

      <PageSearchBar value={query} onChange={setQuery} placeholder={t('customize.skillsPage.searchPlaceholder')} />

      <SettingsInlineEditor
        open={dialogOpen}
        title={editing ? t('customize.skillsPage.editTitle') : t('customize.skillsPage.addTitle')}
        description={t('customize.skillsPage.editorDescription')}
        submitLabel={editing ? t('common.saveChanges') : t('customize.skillsPage.addSkill')}
        onSubmit={() => void saveCustom()}
        onCancel={() => setDialogOpen(false)}
      >
        <FormField label={t('common.name')} required>
          <FormInput
            placeholder={t('customize.skillsPage.namePlaceholder')}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </FormField>
        <FormField label={t('common.description')} hint={t('customize.skillsPage.descriptionHint')}>
          <FormInput
            placeholder={t('customize.skillsPage.descriptionPlaceholder')}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </FormField>
        <FormField label={t('common.content')} required hint={t('customize.skillsPage.contentHint')}>
          <FormTextarea
            placeholder={t('customize.skillsPage.contentPlaceholder')}
            value={form.content}
            onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
          />
        </FormField>
      </SettingsInlineEditor>

      <section className="mb-8">
        <SectionHeading title={t('customize.skillsPage.builtIn')} count={bundled.length} />
        <div className="flex flex-col gap-2">
          {bundled.map((s) => (
            <SkillCard
              key={s.name}
              skill={s}
              onToggle={(on) => void toggleBundled(s.name, on)}
            />
          ))}
        </div>
      </section>

      <section className="mb-8">
        <SectionHeading title={t('customize.skillsPage.custom')} count={custom.length} />
        <div className="flex flex-col gap-2">
          {custom.map((s) => (
            <SkillCard
              key={s.id ?? s.name}
              skill={s}
              onToggle={async (on) => {
                if (s.id) {
                  await settingsApi.updateSkill(s.id, { enabled: on });
                  await load();
                }
              }}
              onEdit={() => openEdit(s)}
              onDelete={async () => {
                if (s.id && confirm(t('customize.skillsPage.confirmDelete'))) {
                  await settingsApi.deleteSkill(s.id);
                  await load();
                }
              }}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
