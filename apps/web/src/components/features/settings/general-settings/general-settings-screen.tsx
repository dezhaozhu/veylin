import { useTranslation } from 'react-i18next';
import { LanguageSettingRow } from '../language-setting-row';

export function GeneralSettingsScreen() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">{t('settings.general.title')}</h1>
      <LanguageSettingRow />
    </div>
  );
}
