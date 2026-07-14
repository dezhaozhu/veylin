import { getTenantSettingsRow, upsertTenantSettings } from '@veylin/db';
import type {
  BusinessSourcePatch,
  BusinessSourcePort,
  BusinessSourceView,
} from '../types.js';
import {
  createRemoteMcpServer,
  listRemoteMcpServers,
  updateRemoteMcpServer,
} from '../../mcp-store.js';

const DEFAULT_NAME = 'business';

function toView(
  stored: NonNullable<Awaited<ReturnType<typeof getTenantSettingsRow>>>['businessSource'],
): BusinessSourceView {
  const s = stored ?? {};
  return {
    enabled: s.enabled === true,
    mcpServerName: s.mcpServerName?.trim() || DEFAULT_NAME,
    hasCredential: Boolean(s.authorization?.trim()),
    toolAllowlist: Array.isArray(s.toolAllowlist) ? s.toolAllowlist.map(String) : [],
    url: s.url?.trim() || undefined,
    transport: s.transport === 'sse' ? 'sse' : 'http',
  };
}

async function loadStored(tenantId: string) {
  const row = await getTenantSettingsRow(tenantId);
  return row?.businessSource ?? {};
}

/**
 * Business source backed by one dedicated MCP server entry + allowlist policy.
 */
export function createMcpBusinessSourcePort(): BusinessSourcePort {
  return {
    id: 'mcp',
    async getSource(tenantId) {
      const stored = await loadStored(tenantId);
      if (!stored.url && !stored.enabled && !stored.mcpServerName) return null;
      return toView(stored);
    },
    async updateSource(tenantId, patch: BusinessSourcePatch) {
      const existing = await loadStored(tenantId);
      const name =
        (patch.mcpServerName ?? existing.mcpServerName ?? DEFAULT_NAME).trim() || DEFAULT_NAME;
      const url = (patch.url ?? existing.url ?? '').trim();
      const transport = patch.transport ?? existing.transport ?? 'http';
      let authorization = existing.authorization ?? '';
      if (patch.clearCredential) authorization = '';
      else if (patch.authorization !== undefined && patch.authorization.trim()) {
        authorization = patch.authorization.trim();
      }

      const next = {
        enabled: patch.enabled ?? existing.enabled ?? false,
        mcpServerName: name,
        url,
        transport: transport === 'sse' ? ('sse' as const) : ('http' as const),
        authorization,
        toolAllowlist: patch.toolAllowlist ?? existing.toolAllowlist ?? [],
      };

      if (url) {
        const headers: Record<string, string> = {};
        if (authorization) {
          headers.Authorization =
            authorization.startsWith('Bearer ') || authorization.includes(' ')
              ? authorization
              : `Bearer ${authorization}`;
        }
        const servers = await listRemoteMcpServers(tenantId);
        const found = servers.find((s) => s.name === name);
        if (found) {
          await updateRemoteMcpServer(tenantId, name, {
            transport: next.transport,
            url,
            headers,
            enabled: next.enabled !== false,
          });
        } else {
          await createRemoteMcpServer(tenantId, {
            name,
            transport: next.transport,
            url,
            headers,
            enabled: next.enabled !== false,
          });
        }
      }

      await upsertTenantSettings(tenantId, { businessSource: next });
      return toView(next);
    },
    async clearSource(tenantId) {
      const empty = {
        enabled: false,
        mcpServerName: DEFAULT_NAME,
        url: '',
        transport: 'http' as const,
        authorization: '',
        toolAllowlist: [] as string[],
      };
      await upsertTenantSettings(tenantId, { businessSource: empty });
      return toView(empty);
    },
    async filterToolsets(tenantId, userId, mcpToolsets) {
      const stored = await loadStored(tenantId);
      const view = toView(stored);
      if (!view.enabled || !view.mcpServerName) {
        return mcpToolsets;
      }

      const { getEnterprisePorts } = await import('../registry.js');
      const org = getEnterprisePorts().org;
      const membership = await org.resolveTenant(userId);
      const out: Record<string, unknown> = {};

      for (const [server, tools] of Object.entries(mcpToolsets)) {
        if (!tools || typeof tools !== 'object') continue;
        if (server !== view.mcpServerName) {
          out[server] = tools;
          continue;
        }
        let entries = Object.entries(tools as Record<string, unknown>);
        if (view.toolAllowlist.length > 0) {
          const allow = new Set(view.toolAllowlist);
          entries = entries.filter(
            ([name]) => allow.has(name) || allow.has(`mcp__${server}__${name}`),
          );
        }
        const allIds = entries.map(([name]) => `mcp__${server}__${name}`);
        const roleFilter = org.allowedToolsForRole?.(membership.role, allIds) ?? null;
        if (roleFilter) {
          const allow = new Set(roleFilter);
          entries = entries.filter(
            ([name]) => allow.has(name) || allow.has(`mcp__${server}__${name}`),
          );
        }
        if (entries.length > 0) out[server] = Object.fromEntries(entries);
      }
      return out;
    },
  };
}
