import { promises as fs } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { spawn } from 'node:child_process';
import {
  getDb,
  normalizeId,
  queryRows,
} from '@veylin/db';
import {
  loadSkillsDir,
  type Skill,
} from '@veylin/agent-package';
import {
  pluginManifestSchema,
  type MarketplaceEntry,
  type PluginInstall,
  type SkillListItem,
} from '@veylin/shared';
import { setPluginSkillsProvider } from './skills-store.js';
import { setPluginHookSourcesProvider } from './hooks-service.js';
import { veylinHome, veylinPluginsDir, veylinPluginsJsonPath } from './veylin-paths.js';

function pluginsRoot(): string {
  return veylinPluginsDir();
}

type PluginsFile = {
  plugins: Record<
    string,
    {
      version: string | null;
      description: string | null;
      sourceType: PluginInstall['sourceType'];
      source: string;
      installPath: string;
      enabled: boolean;
      createdAt?: string;
    }
  >;
};

let pluginsMigrated = false;

async function readPluginsFile(): Promise<PluginsFile> {
  try {
    const raw = JSON.parse(await fs.readFile(veylinPluginsJsonPath(), 'utf8')) as PluginsFile;
    return { plugins: raw.plugins ?? {} };
  } catch {
    return { plugins: {} };
  }
}

async function writePluginsFile(file: PluginsFile): Promise<void> {
  await fs.mkdir(veylinHome(), { recursive: true });
  await fs.writeFile(veylinPluginsJsonPath(), `${JSON.stringify(file, null, 2)}\n`, 'utf8');
}

function entryToInstall(
  tenantId: string,
  name: string,
  entry: PluginsFile['plugins'][string],
): PluginInstall {
  return {
    id: `plugin:${tenantId}:${name}`,
    tenantId,
    name,
    version: entry.version,
    description: entry.description,
    sourceType: entry.sourceType,
    source: entry.source,
    installPath: entry.installPath,
    enabled: entry.enabled,
    createdAt: entry.createdAt,
  };
}

async function migratePluginsFromDb(tenantId: string): Promise<void> {
  if (pluginsMigrated) return;
  pluginsMigrated = true;
  try {
    await fs.access(veylinPluginsJsonPath());
    return;
  } catch {
    // missing
  }
  try {
    const rows = await queryRows<Record<string, unknown>>(
      getDb(),
      'SELECT * FROM plugin_install WHERE tenant_id = $tenantId',
      { tenantId },
    );
    if (rows.length === 0) {
      await writePluginsFile({ plugins: {} });
      return;
    }
    const plugins: PluginsFile['plugins'] = {};
    for (const r of rows) {
      const name = String(r.name);
      plugins[name] = {
        version: r.version != null ? String(r.version) : null,
        description: r.description != null ? String(r.description) : null,
        sourceType: r.source_type as PluginInstall['sourceType'],
        source: String(r.source),
        installPath: String(r.install_path),
        enabled: Boolean(r.enabled),
        createdAt: r.created_at ? String(r.created_at) : undefined,
      };
    }
    await writePluginsFile({ plugins });
    console.info(`[veylin] migrated ${rows.length} plugin install(s) to plugins.json`);
  } catch (err) {
    console.warn('[veylin] plugins.json migration skipped:', err);
    await writePluginsFile({ plugins: {} });
  }
}

export async function listPluginInstalls(tenantId: string): Promise<PluginInstall[]> {
  await migratePluginsFromDb(tenantId);
  const file = await readPluginsFile();
  return Object.entries(file.plugins)
    .map(([name, entry]) => entryToInstall(tenantId, name, entry))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getPluginInstall(
  tenantId: string,
  id: string,
): Promise<PluginInstall | null> {
  await migratePluginsFromDb(tenantId);
  const logicalId = normalizeId(id);
  const file = await readPluginsFile();
  for (const [name, entry] of Object.entries(file.plugins)) {
    const install = entryToInstall(tenantId, name, entry);
    if (install.id === logicalId || name === logicalId || install.id === id) return install;
  }
  return null;
}

async function readManifest(pluginDir: string) {
  const path = join(pluginDir, '.veylin-plugin', 'plugin.json');
  const raw = JSON.parse(await fs.readFile(path, 'utf8')) as unknown;
  return pluginManifestSchema.parse(raw);
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(from, to);
    else await fs.copyFile(from, to);
  }
}

function runGitClone(url: string, dest: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', ['clone', '--depth', '1', url, dest], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let err = '';
    child.stderr?.on('data', (c: Buffer) => {
      err += c.toString();
    });
    child.on('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(err || `git clone failed (${code})`));
    });
  });
}

async function upsertInstall(
  tenantId: string,
  input: {
    name: string;
    version: string | null;
    description: string | null;
    sourceType: PluginInstall['sourceType'];
    source: string;
    installPath: string;
    enabled: boolean;
  },
): Promise<PluginInstall> {
  await migratePluginsFromDb(tenantId);
  const file = await readPluginsFile();
  file.plugins[input.name] = {
    version: input.version,
    description: input.description,
    sourceType: input.sourceType,
    source: input.source,
    installPath: input.installPath,
    enabled: input.enabled,
    createdAt: file.plugins[input.name]?.createdAt ?? new Date().toISOString(),
  };
  await writePluginsFile(file);
  return entryToInstall(tenantId, input.name, file.plugins[input.name]!);
}

export async function installPluginFromPath(
  tenantId: string,
  sourcePath: string,
): Promise<PluginInstall> {
  const abs = resolve(sourcePath);
  const manifest = await readManifest(abs);
  const dest = join(pluginsRoot(), manifest.name);
  await fs.rm(dest, { recursive: true, force: true });
  await copyDir(abs, dest);
  return upsertInstall(tenantId, {
    name: manifest.name,
    version: manifest.version ?? null,
    description: manifest.description ?? null,
    sourceType: 'path',
    source: abs,
    installPath: dest,
    enabled: true,
  });
}

export async function installPluginFromGit(
  tenantId: string,
  url: string,
): Promise<PluginInstall> {
  const tmpName = `git-${Date.now()}`;
  const tmp = join(pluginsRoot(), '.tmp', tmpName);
  await fs.rm(tmp, { recursive: true, force: true });
  await fs.mkdir(join(pluginsRoot(), '.tmp'), { recursive: true });
  await runGitClone(url, tmp);
  const manifest = await readManifest(tmp);
  const dest = join(pluginsRoot(), manifest.name);
  await fs.rm(dest, { recursive: true, force: true });
  await fs.rename(tmp, dest);
  return upsertInstall(tenantId, {
    name: manifest.name,
    version: manifest.version ?? null,
    description: manifest.description ?? null,
    sourceType: 'git',
    source: url,
    installPath: dest,
    enabled: true,
  });
}

export async function setPluginEnabled(
  tenantId: string,
  id: string,
  enabled: boolean,
): Promise<PluginInstall | null> {
  const existing = await getPluginInstall(tenantId, id);
  if (!existing) return null;
  return upsertInstall(tenantId, {
    name: existing.name,
    version: existing.version ?? null,
    description: existing.description ?? null,
    sourceType: existing.sourceType,
    source: existing.source,
    installPath: existing.installPath,
    enabled,
  });
}

export async function uninstallPlugin(tenantId: string, id: string): Promise<boolean> {
  const existing = await getPluginInstall(tenantId, id);
  if (!existing) return false;
  const file = await readPluginsFile();
  delete file.plugins[existing.name];
  await writePluginsFile(file);
  if (existing.installPath.startsWith(pluginsRoot())) {
    await fs.rm(existing.installPath, { recursive: true, force: true });
  }
  return true;
}

export async function loadEnabledPluginSkills(tenantId: string): Promise<SkillListItem[]> {
  const installs = (await listPluginInstalls(tenantId)).filter((p) => p.enabled);
  const items: SkillListItem[] = [];
  for (const plugin of installs) {
    const skillsDir = join(plugin.installPath, 'skills');
    let skills: Skill[] = [];
    try {
      skills = await loadSkillsDir(skillsDir);
    } catch {
      continue;
    }
    for (const skill of skills) {
      const namespaced = `${plugin.name}:${skill.name}`;
      items.push({
        name: namespaced,
        description: skill.description,
        source: 'plugin',
        type: 'knowledge',
        triggers: [],
        enabled: true,
        disableModelInvocation: skill.disableModelInvocation,
        userInvocable: skill.userInvocable,
        content: skill.content,
        path: skill.path,
        pluginId: plugin.name,
      });
    }
  }
  return items;
}

export async function loadEnabledPluginHookSources(
  tenantId: string,
): Promise<Array<{ id: string; root: string }>> {
  return (await listPluginInstalls(tenantId))
    .filter((p) => p.enabled)
    .map((p) => ({ id: p.name, root: p.installPath }));
}

export function registerPluginProviders(): void {
  setPluginSkillsProvider((tenantId) => loadEnabledPluginSkills(tenantId));
  setPluginHookSourcesProvider((tenantId) => loadEnabledPluginHookSources(tenantId));
}

export async function loadMarketplaceCatalog(catalogPath?: string): Promise<MarketplaceEntry[]> {
  const candidates = [
    catalogPath,
    process.env.VEYLIN_MARKETPLACE_CATALOG,
    join(process.env.VEYLIN_REPO_ROOT ?? process.cwd(), 'examples/marketplace/catalog.json'),
  ].filter(Boolean) as string[];

  for (const path of candidates) {
    try {
      const raw = JSON.parse(await fs.readFile(path, 'utf8')) as { plugins?: MarketplaceEntry[] };
      return raw.plugins ?? [];
    } catch {
      /* try next */
    }
  }
  return [];
}

export async function installFromMarketplace(
  tenantId: string,
  entry: MarketplaceEntry,
): Promise<PluginInstall> {
  if (entry.source.type === 'git') {
    const installed = await installPluginFromGit(tenantId, entry.source.url);
    return setPluginEnabled(tenantId, installed.id, true).then((r) => r ?? installed);
  }
  const path = entry.source.url.startsWith('/')
    ? entry.source.url
    : join(process.env.VEYLIN_REPO_ROOT ?? process.cwd(), entry.source.url);
  return installPluginFromPath(tenantId, path);
}

export function pluginDisplayNameFromPath(p: string): string {
  return basename(p);
}
