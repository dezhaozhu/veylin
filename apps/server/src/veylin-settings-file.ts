import { promises as fs } from 'node:fs';
import {
  getTenantSettingsRow,
  upsertTenantSettings,
} from '@veylin/db';
import { resolveWorkspaceRoot } from '@veylin/agent-package';
import { veylinHome, veylinSettingsPath } from './veylin-paths.js';

export type VeylinFileSettings = {
  disabledSkills: string[];
  disabledMcpServers: string[];
  disabledHooks: string[];
  workspaceRoot: string | null;
  importClaudeHooks: boolean;
};

const DEFAULT_SETTINGS: VeylinFileSettings = {
  disabledSkills: [],
  disabledMcpServers: [],
  disabledHooks: [],
  workspaceRoot: null,
  importClaudeHooks: false,
};

let migrated = false;

async function ensureMigratedFromDb(tenantId: string): Promise<void> {
  if (migrated) return;
  migrated = true;
  const path = veylinSettingsPath();
  try {
    await fs.access(path);
    return;
  } catch {
    // missing → try DB
  }
  try {
    const row = await getTenantSettingsRow(tenantId);
    if (!row) {
      await writeSettingsFile(DEFAULT_SETTINGS);
      return;
    }
    await writeSettingsFile({
      disabledSkills: row.disabledSkills ?? [],
      disabledMcpServers: row.disabledMcpServers ?? [],
      disabledHooks: row.disabledHooks ?? [],
      workspaceRoot: row.workspaceRoot ?? null,
      importClaudeHooks: row.importClaudeHooks === true,
    });
    // Clear migrated fields from DB (keep modelSettings).
    await upsertTenantSettings(tenantId, {
      disabledSkills: [],
      disabledMcpServers: [],
      disabledHooks: [],
      workspaceRoot: null,
      importClaudeHooks: false,
    });
  } catch (err) {
    console.warn('[veylin] settings.json migration skipped:', err);
    await writeSettingsFile(DEFAULT_SETTINGS);
  }
}

export async function readSettingsFile(): Promise<VeylinFileSettings> {
  const path = veylinSettingsPath();
  try {
    const raw = JSON.parse(await fs.readFile(path, 'utf8')) as Partial<VeylinFileSettings>;
    return {
      disabledSkills: Array.isArray(raw.disabledSkills) ? raw.disabledSkills.map(String) : [],
      disabledMcpServers: Array.isArray(raw.disabledMcpServers)
        ? raw.disabledMcpServers.map(String)
        : [],
      disabledHooks: Array.isArray(raw.disabledHooks) ? raw.disabledHooks.map(String) : [],
      workspaceRoot: raw.workspaceRoot != null ? String(raw.workspaceRoot) : null,
      importClaudeHooks: raw.importClaudeHooks === true,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function writeSettingsFile(settings: VeylinFileSettings): Promise<void> {
  await fs.mkdir(veylinHome(), { recursive: true });
  await fs.writeFile(veylinSettingsPath(), `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

export async function loadVeylinSettings(tenantId: string): Promise<VeylinFileSettings> {
  await ensureMigratedFromDb(tenantId);
  return readSettingsFile();
}

export async function patchVeylinSettings(
  tenantId: string,
  patch: Partial<VeylinFileSettings>,
): Promise<VeylinFileSettings> {
  const current = await loadVeylinSettings(tenantId);
  const next: VeylinFileSettings = {
    disabledSkills: patch.disabledSkills ?? current.disabledSkills,
    disabledMcpServers: patch.disabledMcpServers ?? current.disabledMcpServers,
    disabledHooks: patch.disabledHooks ?? current.disabledHooks,
    workspaceRoot:
      patch.workspaceRoot !== undefined ? patch.workspaceRoot : current.workspaceRoot,
    importClaudeHooks:
      patch.importClaudeHooks !== undefined
        ? patch.importClaudeHooks
        : current.importClaudeHooks,
  };
  await writeSettingsFile(next);
  return next;
}

export async function getDisabledSkills(tenantId: string): Promise<string[]> {
  return (await loadVeylinSettings(tenantId)).disabledSkills;
}

export async function setDisabledSkills(tenantId: string, disabled: string[]): Promise<void> {
  await patchVeylinSettings(tenantId, { disabledSkills: disabled });
}

export async function getDisabledMcpServers(tenantId: string): Promise<string[]> {
  return (await loadVeylinSettings(tenantId)).disabledMcpServers;
}

export async function setDisabledMcpServers(tenantId: string, disabled: string[]): Promise<void> {
  await patchVeylinSettings(tenantId, { disabledMcpServers: disabled });
}

export async function getDisabledHooks(tenantId: string): Promise<string[]> {
  return (await loadVeylinSettings(tenantId)).disabledHooks;
}

export async function setDisabledHooks(tenantId: string, disabled: string[]): Promise<void> {
  await patchVeylinSettings(tenantId, { disabledHooks: disabled });
}

export async function getWorkspaceRootSetting(tenantId: string): Promise<string | null> {
  const settings = await loadVeylinSettings(tenantId);
  return resolveWorkspaceRoot(settings.workspaceRoot);
}

export async function setWorkspaceRootSetting(
  tenantId: string,
  workspaceRoot: string | null,
): Promise<void> {
  await patchVeylinSettings(tenantId, { workspaceRoot });
}

export async function getImportClaudeHooks(tenantId: string): Promise<boolean> {
  return (await loadVeylinSettings(tenantId)).importClaudeHooks;
}

export async function setImportClaudeHooks(tenantId: string, value: boolean): Promise<void> {
  await patchVeylinSettings(tenantId, { importClaudeHooks: value });
}
