import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { getAgGridLicenseKey, setAgGridLicenseKey } from '@/lib/ag-grid-license';
import { LanguageSettingRow } from '../language-setting-row';

export function GeneralSettingsScreen() {
  const { t } = useTranslation();
  const [agGridKey, setAgGridKey] = useState(() => getAgGridLicenseKey());

  function handleAgGridKeyChange(value: string) {
    setAgGridKey(value);
    setAgGridLicenseKey(value);
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">{t('settings.general.title')}</h1>
      <LanguageSettingRow />

      <div className="mt-8">
        <div className="mb-1 text-sm font-medium">{t('settings.general.agGrid.section')}</div>
        <div className="mt-4">
          <div className="mb-2 text-sm font-medium">{t('settings.general.agGrid.label')}</div>
          <p className="text-muted-foreground mb-2 text-xs">{t('settings.general.agGrid.hint')}</p>
          <div className="bg-muted/60 rounded-xl p-3">
            <Input
              type="password"
              value={agGridKey}
              placeholder={t('settings.general.agGrid.placeholder')}
              onChange={(e) => handleAgGridKeyChange(e.target.value)}
              className="h-10 border-0 bg-background shadow-none focus-visible:ring-0"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
