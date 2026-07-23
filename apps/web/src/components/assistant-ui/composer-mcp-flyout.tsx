import { SearchIcon } from 'lucide-react';
import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { ComposerMenuPanel } from '@/components/assistant-ui/composer-menu-flyout';
import { mcpServerIcon } from '@/lib/mcp-icon';
import { cn } from '@/lib/utils';
import { useSettingsPanel } from '@/hooks/settings/use-settings-panel';

function McpToggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors',
        checked ? 'bg-emerald-500' : 'bg-muted-foreground/30',
      )}
      onClick={() => onChange(!checked)}
    >
      <span
        className={cn(
          'bg-background absolute top-0.5 size-4 rounded-full shadow-sm transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

/** Plus-menu MCP flyout — toggles ungrouped MCP servers for this chat.
 * Grouped ("project") servers are managed exclusively from the sidebar's
 * Projects section (see project-list.tsx) and are excluded here; client-side
 * toggles never affected them server-side anyway (the pin is server-enforced
 * per thread). If every server is grouped, show a hint pointing at the
 * sidebar instead of an empty panel. */
export const ComposerMcpFlyout: FC<{
  servers: string[];
  query: string;
  onQueryChange: (q: string) => void;
  isEnabled: (id: string) => boolean;
  onToggle: (id: string, enabled: boolean) => void;
  groupOf?: (id: string) => string | undefined;
}> = ({ servers, query, onQueryChange, isEnabled, onToggle, groupOf }) => {
  const { t } = useTranslation();
  const { openCustomize } = useSettingsPanel();
  const q = query.trim().toLowerCase();
  const filtered = q ? servers.filter((s) => s.toLowerCase().includes(q)) : servers;
  const ungrouped = groupOf ? filtered.filter((s) => groupOf(s) == null) : filtered;

  return (
    <ComposerMenuPanel>
      <div className="relative mb-1 px-1">
        <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2" />
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={t('mention.searchMcp')}
          className="border-input bg-background h-8 w-full rounded-md border pr-2 pl-8 text-xs outline-none"
        />
      </div>
      <div className="max-h-56 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="text-muted-foreground px-2.5 py-2 text-xs">{t('mention.noMcpServers')}</div>
        )}
        {filtered.length > 0 && ungrouped.length === 0 && (
          <div className="text-muted-foreground px-2.5 py-2 text-xs">
            {t('mention.projectsInSidebar')}
          </div>
        )}
        {ungrouped.map((server) => {
          const icon = mcpServerIcon(server);
          const on = isEnabled(server);
          return (
            <div
              key={server}
              className="hover:bg-accent flex items-center gap-2 rounded-md px-2 py-1.5"
            >
              <div className="relative shrink-0">
                <div
                  className={cn(
                    'flex size-6 items-center justify-center rounded text-[10px] font-semibold text-white',
                    icon.bg,
                  )}
                >
                  {icon.label}
                </div>
                <span
                  className={cn(
                    'absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full ring-2 ring-popover',
                    icon.dot,
                  )}
                />
              </div>
              <span className="min-w-0 flex-1 truncate text-sm">{server}</span>
              <McpToggle
                checked={on}
                onChange={(enabled) => onToggle(server, enabled)}
                label={t('mention.mcpToggle', { name: server })}
              />
            </div>
          );
        })}
      </div>
      <div className="border-border mt-1 border-t pt-1">
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground w-full px-2.5 py-1.5 text-left text-xs hover:underline"
          onClick={() => openCustomize('mcp')}
        >
          {t('mention.openMcpSettings')}
        </button>
      </div>
    </ComposerMenuPanel>
  );
};
