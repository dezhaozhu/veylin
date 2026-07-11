import { useCallback, useEffect, useState } from 'react';
import { Puzzle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MarketplaceEntry, PluginInstall } from '@/hooks/settings/api';
import { settingsApi } from '@/hooks/settings/api';
import {
  FormField,
  FormInput,
  SettingsFormDialog,
} from '../settings-form-dialog';
import { SettingsDeleteDialog } from '../settings-item-actions';
import {
  PageHeader,
  PrimaryActionButton,
  SectionHeading,
} from '../page-header';
import {
  SettingsConnectedList,
  SettingsListIcon,
  SettingsListRow,
} from '../settings-list';

export function PluginsSettingsScreen() {
  const { t } = useTranslation();
  const [installed, setInstalled] = useState<PluginInstall[]>([]);
  const [marketplace, setMarketplace] = useState<MarketplaceEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [installForm, setInstallForm] = useState({ type: 'path' as 'path' | 'git', value: '' });
  const [deleteTarget, setDeleteTarget] = useState<PluginInstall | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await settingsApi.getPlugins();
      setInstalled(data.installed);
      setMarketplace(data.marketplace);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.loadFailed'));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const install = async () => {
    if (!installForm.value.trim()) return;
    const body =
      installForm.type === 'path'
        ? { type: 'path' as const, path: installForm.value.trim() }
        : { type: 'git' as const, url: installForm.value.trim() };
    try {
      const res = await settingsApi.installPlugin(body);
      if (!res.ok) {
        alert(res.message ?? t('customize.pluginsPage.installFailed'));
        return;
      }
      setDialogOpen(false);
      setInstallForm({ type: 'path', value: '' });
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : t('customize.pluginsPage.installFailed'));
    }
  };

  const toggleEnabled = async (plugin: PluginInstall) => {
    try {
      await settingsApi.setPluginEnabled(plugin.id, !plugin.enabled);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await settingsApi.uninstallPlugin(deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  if (error && installed.length === 0) {
    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-3">
        <p className="text-muted-foreground text-sm">{error}</p>
        <button type="button" className="border-border rounded-md border px-3 py-1.5 text-sm" onClick={() => void load()}>
          {t('common.retry')}
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={t('customize.pluginsPage.title')}
        description={t('customize.pluginsPage.description')}
        action={
          <PrimaryActionButton onClick={() => setDialogOpen(true)}>
            {t('customize.pluginsPage.addPlugin')}
          </PrimaryActionButton>
        }
      />

      <SettingsFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={t('customize.pluginsPage.installTitle')}
        description={t('customize.pluginsPage.installDescription')}
        submitLabel={t('customize.pluginsPage.install')}
        onSubmit={() => void install()}
      >
        <FormField label={t('customize.pluginsPage.sourceType')}>
          <select
            className="border-border bg-background w-full rounded-md border px-3 py-2 text-sm"
            value={installForm.type}
            onChange={(e) =>
              setInstallForm((f) => ({ ...f, type: e.target.value as 'path' | 'git' }))
            }
          >
            <option value="path">{t('customize.pluginsPage.fromPath')}</option>
            <option value="git">{t('customize.pluginsPage.fromGit')}</option>
          </select>
        </FormField>
        <FormField label={installForm.type === 'path' ? t('customize.pluginsPage.path') : t('customize.pluginsPage.gitUrl')}>
          <FormInput
            value={installForm.value}
            onChange={(e) => setInstallForm((f) => ({ ...f, value: e.target.value }))}
            placeholder={
              installForm.type === 'path'
                ? '/path/to/plugin'
                : 'https://github.com/org/plugin.git'
            }
          />
        </FormField>
      </SettingsFormDialog>

      <section className="mb-8">
        <SectionHeading title={t('customize.pluginsPage.installed')} count={installed.length} />
        {installed.length > 0 ? (
          <SettingsConnectedList>
            {installed.map((p) => (
              <SettingsListRow
                key={p.id}
                icon={
                  <SettingsListIcon statusDot={p.enabled}>
                    <Puzzle className="size-4" />
                  </SettingsListIcon>
                }
                title={p.name}
                subtitle={`${p.description ?? ''} · ${p.sourceType} · ${p.installPath}`.trim()}
                menuItems={[
                  {
                    label: p.enabled ? t('common.disable') : t('common.enable'),
                    onClick: () => {
                      void toggleEnabled(p);
                    },
                  },
                  {
                    label: t('common.delete'),
                    destructive: true,
                    onClick: () => setDeleteTarget(p),
                  },
                ]}
              />
            ))}
          </SettingsConnectedList>
        ) : (
          <p className="text-muted-foreground mb-6 text-sm">{t('customize.pluginsPage.installedEmpty')}</p>
        )}
      </section>

      <section className="mb-8">
        <SectionHeading title={t('customize.pluginsPage.marketplace')} count={marketplace.length} />
        {marketplace.length > 0 ? (
          <SettingsConnectedList>
            {marketplace.map((entry) => (
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
                    label: t('customize.pluginsPage.installFromMarket'),
                    onClick: () => {
                      void settingsApi
                        .installPlugin({ type: 'marketplace', name: entry.name })
                        .then((res) => {
                          if (!res.ok) alert(res.message ?? t('customize.pluginsPage.installFailed'));
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
          <p className="text-muted-foreground mb-6 text-sm">{t('customize.pluginsPage.marketplaceEmpty')}</p>
        )}
      </section>

      <SettingsDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t('customize.pluginsPage.deleteTitle')}
        description={t('customize.pluginsPage.confirmDelete', { name: deleteTarget?.name ?? '' })}
        onConfirm={confirmDelete}
        busy={deleting}
      />
    </div>
  );
}
