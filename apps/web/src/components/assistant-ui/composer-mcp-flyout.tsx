import { SearchIcon } from 'lucide-react';
import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { ComposerMenuPanel } from '@/components/assistant-ui/composer-menu-flyout';
import { mcpServerIcon } from '@/lib/mcp-icon';
import { type McpGroupMember, useGroupedMcpServers } from '@/lib/mcp-groups-sync';
import { cn } from '@/lib/utils';
import { useSettingsPanel } from '@/hooks/settings/use-settings-panel';

/** Shared capability name for a group: the common name-prefix before the
 * first '-' across every member (e.g. "compass", "compass-guolu" ->
 * "compass"), lowercase as-is; falls back to the raw group id if members
 * don't share one. */
function capabilityLabel(groupId: string, members: McpGroupMember[]): string {
  const names = members.filter((m) => m.group === groupId).map((m) => m.name);
  if (names.length === 0) return groupId;
  const prefixes = names.map((name) => name.split('-')[0] ?? name);
  const first = prefixes[0];
  if (!first || !prefixes.every((p) => p === first)) return groupId;
  return first;
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

/** One row: icon + name + on/off toggle. Identical for an ungrouped server
 * and a grouped capability — the row doesn't know or care which. */
function McpServerRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (enabled: boolean) => void;
}) {
  const { t } = useTranslation();
  const icon = mcpServerIcon(label);
  return (
    <div className="hover:bg-accent flex items-center gap-2 rounded-md px-2 py-1.5">
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
      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
      <McpToggle checked={checked} onChange={onChange} label={t('mention.mcpToggle', { name: label })} />
    </div>
  );
}

/** Plus-menu MCP flyout — toggles MCP servers for this chat. Grouped
 * ("project") servers (see project-list.tsx: which member of a group is
 * active for a thread is a project pin, managed from the sidebar) collapse
 * to one row per group — label is the group's shared capability name — that
 * looks and behaves exactly like an ungrouped server row. Toggling it writes
 * the same mcpEnabled value to every member of the group, so the off-state
 * survives project switches: it's a plain "does this chat get this
 * capability's tools" switch, never a data-source picker (the composer's
 * project chip already shows which source is pinned). */
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
  const groupedServers = useGroupedMcpServers();
  const q = query.trim().toLowerCase();
  const filtered = q ? servers.filter((s) => s.toLowerCase().includes(q)) : servers;
  const ungrouped = groupOf ? filtered.filter((s) => groupOf(s) == null) : filtered;
  const groups = groupOf
    ? Array.from(new Set(filtered.filter((s) => groupOf(s) != null).map((s) => groupOf(s) as string))).map(
        (groupId) => ({
          groupId,
          members: filtered.filter((s) => groupOf(s) === groupId),
        }),
      )
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
        {ungrouped.map((server) => (
          <McpServerRow
            key={server}
            label={server}
            checked={isEnabled(server)}
            onChange={(enabled) => onToggle(server, enabled)}
          />
        ))}
        {groups.map(({ groupId, members }) => (
          <McpServerRow
            key={groupId}
            label={capabilityLabel(groupId, groupedServers)}
            checked={members.length === 0 || members.every((m) => isEnabled(m))}
            onChange={(enabled) => members.forEach((m) => onToggle(m, enabled))}
          />
        ))}
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
