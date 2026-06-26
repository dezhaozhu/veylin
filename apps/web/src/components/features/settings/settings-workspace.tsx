import { useState } from 'react';
import { Box, Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GeneralSettingsScreen } from './general-settings/general-settings-screen';
import { ModelsSettingsScreen } from './models-settings/models-settings-screen';
import { cn } from '@/lib/utils';
import { startWindowDrag } from '@/lib/window-drag';

type SettingsTab = 'general' | 'models';

export function SettingsWorkspace() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<SettingsTab>('general');

  return (
    <div className="bg-background flex min-h-0 min-w-0 flex-1">
      <aside className="border-border bg-muted/20 flex w-52 shrink-0 flex-col border-r">
        <div
          data-tauri-drag-region
          className="border-border border-b px-4 py-3"
          onMouseDown={startWindowDrag}
        >
          <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {t('settings.navTitle')}
          </span>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 p-2">
          <button
            type="button"
            onClick={() => setTab('general')}
            className={cn(
              'flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium',
              tab === 'general' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60',
            )}
          >
            <Settings2 className="size-4 shrink-0 opacity-80" />
            {t('settings.general.nav')}
          </button>
          <button
            type="button"
            onClick={() => setTab('models')}
            className={cn(
              'flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium',
              tab === 'models' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60',
            )}
          >
            <Box className="size-4 shrink-0 opacity-80" />
            {t('settings.models.nav')}
          </button>
        </nav>
      </aside>
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-8 py-6">
        {tab === 'general' ? <GeneralSettingsScreen /> : <ModelsSettingsScreen />}
      </main>
    </div>
  );
}
