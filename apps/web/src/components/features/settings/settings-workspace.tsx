import { Box } from 'lucide-react';
import { ModelsSettingsScreen } from './models-settings/models-settings-screen';
import { cn } from '@/lib/utils';

export function SettingsWorkspace() {
  return (
    <div className="bg-background flex min-h-0 min-w-0 flex-1">
      <aside className="border-border bg-muted/20 flex w-52 shrink-0 flex-col border-r">
        <div className="border-border border-b px-4 py-3">
          <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Settings
          </span>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 p-2">
          <button
            type="button"
            className={cn(
              'flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium',
              'bg-accent text-foreground',
            )}
          >
            <Box className="size-4 shrink-0 opacity-80" />
            Models
          </button>
        </nav>
      </aside>
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-8 py-6">
        <ModelsSettingsScreen />
      </main>
    </div>
  );
}
