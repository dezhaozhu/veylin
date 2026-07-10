import { useCallback, useEffect, useMemo, useState } from 'react';
import { Puzzle, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MarketplaceEntry, PluginInstall, SkillListItem } from '@/hooks/settings/api';
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

function skillSubtitle(skill: SkillListItem, sourceLabel: string): string {
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
  const desc = raw.replace(/\s+/g, ' ').trim();
  return desc ? `${sourceLabel} · ${desc}` : sourceLabel;
}

function SkillRow({
  skill,
  sourceLabel,
  onToggle,
  onEdit,
  onDelete,
  deleteDisabled,
}: {
  skill: SkillListItem;
  sourceLabel: string;
  onToggle: (enabled: boolean) => void;
  onEdit?: () => void;
  onDelete?: () => void;
  /** Show delete in menu but not clickable (built-in). */
  deleteDisabled?: boolean;
}) {
  const { t } = useTranslation();

  const menuItems = [
    {
      label: skill.enabled ? t('common.disable') : t('common.enable'),
      onClick: () => onToggle(!skill.enabled),
    },
    ...(onEdit ? [{ label: t('common.edit'), onClick: onEdit }] : []),
    ...(onDelete || deleteDisabled
      ? [
          {
            label: t('common.delete'),
            onClick: () => {
              if (!deleteDisabled) onDelete?.();
            },
            destructive: true,
            disabled: Boolean(deleteDisabled),
          },
        ]
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
      subtitle={skillSubtitle(skill, sourceLabel)}
      menuItems={menuItems}
    />
  );
}

export function SkillsSettingsScreen() {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<SkillListItem[]>([]);
  const [installedPlugins, setInstalledPlugins] = useState<PluginInstall[]>([]);
  const [marketplace, setMarketplace] = useState<MarketplaceEntry[]>([]);
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SkillListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SkillListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', content: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [skillsData, pluginsData] = await Promise.all([
        settingsApi.getSkills(),
        settingsApi.getPlugins(),
      ]);
      setSkills(skillsData.skills);
      setDisabled(new Set(skillsData.disabledSkills));
      setInstalledPlugins(pluginsData.installed);
      setMarketplace(pluginsData.marketplace);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('customize.skillsPage.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const q = query.trim().toLowerCase();
  const installed = useMemo(
    () =>
      skills.filter(
        (s) =>
          !q ||
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.source.toLowerCase().includes(q),
      ),
    [skills, q],
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

  const sourceLabel = (skill: SkillListItem) =>
    t(`customize.skillsPage.source.${skill.source}`, {
      defaultValue: skill.source,
    });

  const toggleSkill = async (name: string, enabled: boolean) => {
    const next = new Set(disabled);
    if (enabled) next.delete(name);
    else next.add(name);
    setDisabled(next);
    setSkills((prev) => prev.map((s) => (s.name === name ? { ...s, enabled } : s)));
    try {
      await settingsApi.saveDisabledSkills([...next]);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
      await load();
    }
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
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      if (deleteTarget.source === 'plugin') {
        const pluginName = deleteTarget.pluginId ?? deleteTarget.name.split(':')[0];
        const plugin = installedPlugins.find((p) => p.name === pluginName);
        if (!plugin) throw new Error(t('customize.skillsPage.pluginNotFound'));
        await settingsApi.uninstallPlugin(plugin.id);
      } else {
        const id = deleteTarget.id ?? deleteTarget.name;
        await settingsApi.deleteSkill(id);
      }
      setDeleteTarget(null);
      await load();
    } catch (err) {
      alert(
        t('customize.skillsPage.saveFailed', {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      setDeleting(false);
    }
  };

  const saveSkill = async () => {
    if (!form.name.trim() || !form.content.trim()) return;
    try {
      const id = editing?.id ?? editing?.name;
      if (id) await settingsApi.updateSkill(id, form);
      else await settingsApi.createSkill(form);
      setDialogOpen(false);
      setEditing(null);
      await load();
    } catch (err) {
      alert(
        t('customize.skillsPage.saveFailed', {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  };

  if (loading) {
    return <div className="text-muted-foreground text-sm">{t('customize.skillsPage.loading')}</div>;
  }

  if (loadError) {
    return (
      <div className="mx-auto flex max-w-4xl flex-col items-start gap-3">
        <p className="text-muted-foreground text-sm">{t('customize.skillsPage.loadFailed')}</p>
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
        title={t('customize.skillsPage.title')}
        description={t('customize.skillsPage.description')}
        action={
          <PrimaryActionButton onClick={openCreate}>{t('customize.skillsPage.addSkill')}</PrimaryActionButton>
        }
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
        onSubmit={() => void saveSkill()}
        onCancel={() => setEditing(null)}
      >
        <FormField label={t('common.name')} required>
          <FormInput
            placeholder={t('customize.skillsPage.namePlaceholder')}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            disabled={Boolean(editing)}
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
        <SectionHeading title={t('customize.skillsPage.installed')} count={installed.length} />
        {installed.length > 0 ? (
          <SettingsConnectedList>
            {installed.map((s) => (
              <SkillRow
                key={`${s.source}:${s.pluginId ?? ''}:${s.id ?? s.name}`}
                skill={s}
                sourceLabel={sourceLabel(s)}
                onToggle={(on) => void toggleSkill(s.name, on)}
                onEdit={s.source === 'user' ? () => openEdit(s) : undefined}
                onDelete={
                  s.source === 'user' || s.source === 'plugin'
                    ? () => setDeleteTarget(s)
                    : undefined
                }
                deleteDisabled={s.source === 'bundled'}
              />
            ))}
          </SettingsConnectedList>
        ) : (
          <p className="text-muted-foreground mb-6 text-sm">{t('customize.skillsPage.installedEmpty')}</p>
        )}
      </section>

      <section className="mb-8">
        <SectionHeading title={t('customize.skillsPage.marketplace')} count={marketplaceFiltered.length} />
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
                    label: t('customize.skillsPage.installFromMarket'),
                    onClick: () => {
                      void settingsApi
                        .installPlugin({ type: 'marketplace', name: entry.name })
                        .then((res) => {
                          if (!res.ok) {
                            alert(res.message ?? t('customize.pluginsPage.installFailed'));
                            return;
                          }
                          return load();
                        })
                        .catch((err) => {
                          alert(err instanceof Error ? err.message : String(err));
                        });
                    },
                  },
                ]}
              />
            ))}
          </SettingsConnectedList>
        ) : (
          <p className="text-muted-foreground mb-6 text-sm">{t('customize.skillsPage.marketplaceEmpty')}</p>
        )}
      </section>

      <SettingsDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={
          deleteTarget?.source === 'plugin'
            ? t('customize.skillsPage.deletePluginTitle')
            : t('customize.skillsPage.deleteTitle')
        }
        description={
          deleteTarget?.source === 'plugin'
            ? t('customize.skillsPage.confirmDeletePlugin', {
                name: deleteTarget.pluginId ?? deleteTarget.name,
              })
            : t('customize.skillsPage.confirmDelete')
        }
        onConfirm={confirmDelete}
        busy={deleting}
      />
    </div>
  );
}
