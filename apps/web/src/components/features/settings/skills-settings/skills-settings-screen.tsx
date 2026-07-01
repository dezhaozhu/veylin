import { useCallback, useEffect, useMemo, useState } from 'react';
import { Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SkillListItem } from '@/hooks/settings/api';
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
import {
  SettingsConnectedList,
  SettingsListIcon,
  SettingsListRow,
} from '../settings-list';

function skillSubtitle(skill: SkillListItem): string {
  const raw =
    skill.description?.trim() ||
    (skill.content?.trim()
      ? skill.content
          .trim()
          .split('\n')
          .find((l) => l.trim() && !l.startsWith('#'))
          ?.trim()
      : '') ||
    skill.triggers?.join(', ') ||
    '';
  return raw.replace(/\s+/g, ' ').trim();
}

function SkillRow({
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

  const menuItems = [
    {
      label: skill.enabled ? t('common.disable') : t('common.enable'),
      onClick: () => onToggle(!skill.enabled),
    },
    ...(onEdit
      ? [{ label: t('common.edit'), onClick: onEdit }]
      : []),
    ...(onDelete
      ? [{ label: t('common.delete'), onClick: onDelete, destructive: true }]
      : []),
  ];

  return (
    <SettingsListRow
      icon={
        <SettingsListIcon statusDot={skill.enabled}>
          <Zap className="size-4" />
        </SettingsListIcon>
      }
      title={skill.name}
      subtitle={skillSubtitle(skill)}
      menuItems={menuItems}
    />
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
  const [deleteTarget, setDeleteTarget] = useState<SkillListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
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

  const confirmDelete = async () => {
    if (!deleteTarget?.id || deleting) return;
    setDeleting(true);
    try {
      await settingsApi.deleteSkill(deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      alert(t('customize.skillsPage.saveFailed', { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setDeleting(false);
    }
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

      <SettingsFormDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditing(null);
        }}
        title={editing ? t('customize.skillsPage.editTitle') : t('customize.skillsPage.addTitle')}
        description={t('customize.skillsPage.editorDescription')}
        submitLabel={editing ? t('common.saveChanges') : t('customize.skillsPage.addSkill')}
        onSubmit={() => void saveCustom()}
        onCancel={() => setEditing(null)}
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
      </SettingsFormDialog>

      <section className="mb-8">
        <SectionHeading title={t('customize.skillsPage.builtIn')} count={bundled.length} />
        <SettingsConnectedList>
          {bundled.map((s) => (
            <SkillRow
              key={s.name}
              skill={s}
              onToggle={(on) => void toggleBundled(s.name, on)}
            />
          ))}
        </SettingsConnectedList>
      </section>

      <section className="mb-8">
        <SectionHeading title={t('customize.skillsPage.custom')} count={custom.length} />
        {custom.length > 0 ? (
          <SettingsConnectedList>
            {custom.map((s) => (
              <SkillRow
                key={s.id ?? s.name}
                skill={s}
                onToggle={async (on) => {
                  if (s.id) {
                    await settingsApi.updateSkill(s.id, { enabled: on });
                    await load();
                  }
                }}
                onEdit={() => openEdit(s)}
                onDelete={() => setDeleteTarget(s)}
              />
            ))}
          </SettingsConnectedList>
        ) : null}
      </section>

      <SettingsDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t('customize.skillsPage.deleteTitle')}
        description={t('customize.skillsPage.confirmDelete')}
        onConfirm={confirmDelete}
        busy={deleting}
      />
    </div>
  );
}
