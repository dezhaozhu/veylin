import { SearchIcon } from 'lucide-react';
import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { ComposerMenuPanel } from '@/components/assistant-ui/composer-menu-flyout';
import { mcpServerIcon } from '@/lib/mcp-icon';
import { type McpGroupMember, useMcpServerHealth } from '@/lib/mcp-groups-sync';
import { projectLabel } from '@/lib/project-labels';
import { cn } from '@/lib/utils';
import { useSettingsPanel } from '@/hooks/settings/use-settings-panel';
import { useProjectScope } from '@/lib/use-composer-settings';

/** Shared capability name for a group: if every member's name shares a
 * common prefix before the first '-' (e.g. "compass", "compass-guolu" ->
 * "compass"), capitalize that; otherwise fall back to the raw group id. */
function capabilityLabel(groupId: string, members: McpGroupMember[]): string {
  const names = members.filter((m) => m.group === groupId).map((m) => m.name);
  if (names.length === 0) return groupId;
  const prefixes = names.map((name) => name.split('-')[0] ?? name);
  const first = prefixes[0];
  if (!first || !prefixes.every((p) => p === first)) return groupId;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

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
 * per thread). Instead of hiding grouped servers entirely, each group renders
 * a read-only capability-status row (shared capability name + whether the
 * current thread's pinned member is actually connected) so the user still
 * sees "one Compass capability, N data sources chosen by the sidebar". */
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
  const { groupedServers, currentProject } = useProjectScope();
  const health = useMcpServerHealth();
  const q = query.trim().toLowerCase();
  const filtered = q ? servers.filter((s) => s.toLowerCase().includes(q)) : servers;
  const ungrouped = groupOf ? filtered.filter((s) => groupOf(s) == null) : filtered;
  const groupIds = groupOf
    ? Array.from(new Set(filtered.filter((s) => groupOf(s) != null).map((s) => groupOf(s) as string)))
    : [];

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
        {filtered.length > 0 &&
          ungrouped.length === 0 &&
          groupIds.map((groupId) => {
            const label = capabilityLabel(groupId, groupedServers);
            const pinnedHere =
              currentProject && groupedServers.some((m) => m.group === groupId && m.name === currentProject)
                ? currentProject
                : null;
            const connected = pinnedHere ? Boolean(health.get(pinnedHere)?.connected) : false;
            return (
              <div key={groupId} className="flex items-center gap-2 px-2.5 py-2 text-xs">
                <span
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    connected ? 'bg-emerald-500' : 'bg-red-500',
                  )}
                />
                <span className="text-muted-foreground truncate">
                  {connected
                    ? t('mention.capabilityStatusConnected', {
                        capability: label,
                        source: projectLabel(pinnedHere as string),
                      })
                    : t('mention.capabilityStatusDisconnected', { capability: label })}
                </span>
              </div>
            );
          })}
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
