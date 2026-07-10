import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  DORMANT_HOOK_EVENTS,
  parseHooksFile,
  type HookEvent,
  type HookHandler,
  type HookSource,
  type HooksConfig,
  type LoadedHookHandler,
} from './schema.js';

export interface LoadHooksOptions {
  workspaceRoot?: string | null;
  homeDir?: string;
  /** ~/.veylin data / config home. Defaults to ~/.veylin */
  veylinHome?: string;
  importClaudeHooks?: boolean;
  allowManagedHooksOnly?: boolean;
  managedConfig?: HooksConfig;
  /** Enabled plugins: id → { root, hooksConfig? } */
  plugins?: Array<{ id: string; root: string; hooks?: HooksConfig }>;
  /** Extra frontmatter / skill-scoped handlers (active for this emit only usually). */
  ephemeral?: LoadedHookHandler[];
  disabledKeys?: Set<string>;
}

function handlerKey(event: HookEvent, handler: HookHandler, source: HookSource, sourceId?: string): string {
  const id = sourceId ?? '';
  if (handler.type === 'command') {
    return `${event}|${source}|${id}|command|${handler.command}|${(handler.args ?? []).join('\0')}`;
  }
  if (handler.type === 'http') {
    return `${event}|${source}|${id}|http|${handler.url}`;
  }
  if (handler.type === 'mcp_tool') {
    return `${event}|${source}|${id}|mcp|${handler.server}|${handler.tool}`;
  }
  if (handler.type === 'prompt') {
    return `${event}|${source}|${id}|prompt|${handler.prompt}`;
  }
  return `${event}|${source}|${id}|agent|${handler.prompt}|${handler.subagent_type ?? ''}`;
}

async function readHooksFile(path: string): Promise<HooksConfig | null> {
  try {
    const raw = await fs.readFile(path, 'utf8');
    return parseHooksFile(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function expandConfig(
  config: HooksConfig,
  source: HookSource,
  opts: { sourceId?: string; pluginRoot?: string; configPath?: string },
): LoadedHookHandler[] {
  const out: LoadedHookHandler[] = [];
  for (const [event, groups] of Object.entries(config) as Array<[HookEvent, typeof config[HookEvent]]>) {
    if (!groups) continue;
    for (const group of groups) {
      for (const handler of group.hooks) {
        out.push({
          event,
          matcher: group.matcher,
          handler,
          source,
          sourceId: opts.sourceId,
          pluginRoot: opts.pluginRoot,
          configPath: opts.configPath,
          enabled: true,
          dormant: DORMANT_HOOK_EVENTS.has(event),
        });
      }
    }
  }
  return out;
}

async function loadClaudeSettingsHooks(
  path: string,
  source: HookSource,
): Promise<LoadedHookHandler[]> {
  try {
    const raw = JSON.parse(await fs.readFile(path, 'utf8')) as { hooks?: unknown };
    if (!raw.hooks) return [];
    const config = parseHooksFile({ hooks: raw.hooks });
    return expandConfig(config, source, { configPath: path, sourceId: 'claude' });
  } catch {
    return [];
  }
}

/**
 * Load and merge hooks from managed → user → project → plugins → claude compat.
 * Dedupes identical command/http handlers.
 */
export async function loadAllHooks(options: LoadHooksOptions = {}): Promise<LoadedHookHandler[]> {
  const home = options.homeDir ?? homedir();
  const veylinHome = options.veylinHome ?? join(home, '.veylin');
  const workspace = options.workspaceRoot?.trim() || null;
  const disabled = options.disabledKeys ?? new Set<string>();

  const collected: LoadedHookHandler[] = [];

  if (options.managedConfig) {
    collected.push(...expandConfig(options.managedConfig, 'managed', { sourceId: 'managed' }));
  }

  if (!options.allowManagedHooksOnly) {
    const userPath = join(veylinHome, 'hooks.json');
    const userCfg = await readHooksFile(userPath);
    if (userCfg) collected.push(...expandConfig(userCfg, 'user', { configPath: userPath }));

    if (workspace) {
      const projectPath = join(workspace, '.veylin', 'hooks.json');
      const projectCfg = await readHooksFile(projectPath);
      if (projectCfg) {
        collected.push(...expandConfig(projectCfg, 'project', { configPath: projectPath }));
      }
      const localPath = join(workspace, '.veylin', 'hooks.local.json');
      const localCfg = await readHooksFile(localPath);
      if (localCfg) {
        collected.push(...expandConfig(localCfg, 'project_local', { configPath: localPath }));
      }
    }

    for (const plugin of options.plugins ?? []) {
      let cfg = plugin.hooks;
      const hooksPath = join(plugin.root, 'hooks', 'hooks.json');
      if (!cfg) cfg = (await readHooksFile(hooksPath)) ?? undefined;
      if (cfg) {
        collected.push(
          ...expandConfig(cfg, 'plugin', {
            sourceId: plugin.id,
            pluginRoot: plugin.root,
            configPath: hooksPath,
          }),
        );
      }
    }

    if (options.importClaudeHooks === true) {
      collected.push(
        ...(await loadClaudeSettingsHooks(join(home, '.claude', 'settings.json'), 'claude_compat')),
      );
      if (workspace) {
        collected.push(
          ...(await loadClaudeSettingsHooks(
            join(workspace, '.claude', 'settings.json'),
            'claude_compat',
          )),
        );
      }
    }
  }

  if (options.ephemeral?.length) {
    collected.push(...options.ephemeral);
  }

  const seen = new Set<string>();
  const deduped: LoadedHookHandler[] = [];
  for (const item of collected) {
    const key = handlerKey(item.event, item.handler, item.source, item.sourceId);
    if (disabled.has(key)) {
      item.enabled = false;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

export function hookIdentityKey(h: LoadedHookHandler): string {
  return handlerKey(h.event, h.handler, h.source, h.sourceId);
}
