import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  parseHooksFile,
  type HookEvent,
  type HookHandler,
  type HooksConfig,
  type LoadedHookHandler,
} from './schema.js';
import { hookIdentityKey, loadAllHooks } from './loader.js';

export function userHooksPath(veylinHome?: string, homeDir?: string): string {
  const home = veylinHome ?? join(homeDir ?? homedir(), '.veylin');
  return join(home, 'hooks.json');
}

export async function readUserHooksConfig(veylinHome?: string, homeDir?: string): Promise<HooksConfig> {
  const path = userHooksPath(veylinHome, homeDir);
  try {
    const raw = JSON.parse(await fs.readFile(path, 'utf8')) as unknown;
    return parseHooksFile(raw);
  } catch {
    return {};
  }
}

export async function writeUserHooksConfig(
  config: HooksConfig,
  veylinHome?: string,
  homeDir?: string,
): Promise<string> {
  const path = userHooksPath(veylinHome, homeDir);
  await fs.mkdir(join(path, '..'), { recursive: true });
  await fs.writeFile(path, `${JSON.stringify({ hooks: config }, null, 2)}\n`, 'utf8');
  return path;
}

function cloneConfig(config: HooksConfig): HooksConfig {
  return structuredClone(config);
}

export async function addUserHook(input: {
  event: HookEvent;
  matcher?: string;
  handler: HookHandler;
  veylinHome?: string;
  homeDir?: string;
}): Promise<{ key: string; config: HooksConfig }> {
  const config = cloneConfig(await readUserHooksConfig(input.veylinHome, input.homeDir));
  const groups = config[input.event] ?? [];
  const matcher = input.matcher?.trim() || undefined;
  const existing = groups.find((g) => (g.matcher ?? undefined) === matcher);
  if (existing) {
    existing.hooks.push(input.handler);
  } else {
    groups.push({ matcher, hooks: [input.handler] });
  }
  config[input.event] = groups;
  await writeUserHooksConfig(config, input.veylinHome, input.homeDir);
  const loaded: LoadedHookHandler = {
    event: input.event,
    matcher,
    handler: input.handler,
    source: 'user',
    configPath: userHooksPath(input.veylinHome, input.homeDir),
    enabled: true,
    dormant: false,
  };
  return { key: hookIdentityKey(loaded), config };
}

export async function removeUserHookByKey(input: {
  key: string;
  veylinHome?: string;
  homeDir?: string;
}): Promise<boolean> {
  const config = cloneConfig(await readUserHooksConfig(input.veylinHome, input.homeDir));
  let removed = false;
  for (const [event, groups] of Object.entries(config) as Array<[HookEvent, NonNullable<HooksConfig[HookEvent]>]>) {
    if (!groups) continue;
    const nextGroups = [];
    for (const group of groups) {
      const nextHooks = group.hooks.filter((handler) => {
        const loaded: LoadedHookHandler = {
          event,
          matcher: group.matcher,
          handler,
          source: 'user',
          enabled: true,
          dormant: false,
        };
        if (hookIdentityKey(loaded) === input.key) {
          removed = true;
          return false;
        }
        return true;
      });
      if (nextHooks.length > 0) nextGroups.push({ ...group, hooks: nextHooks });
    }
    if (nextGroups.length > 0) config[event] = nextGroups;
    else delete config[event];
  }
  if (!removed) return false;
  await writeUserHooksConfig(config, input.veylinHome, input.homeDir);
  return true;
}

export async function updateUserHookByKey(input: {
  key: string;
  event?: HookEvent;
  matcher?: string;
  handler?: HookHandler;
  veylinHome?: string;
  homeDir?: string;
}): Promise<boolean> {
  const existing = await loadAllHooks({
    veylinHome: input.veylinHome,
    homeDir: input.homeDir,
    importClaudeHooks: false,
    plugins: [],
  });
  const hit = existing.find((h) => h.source === 'user' && hookIdentityKey(h) === input.key);
  if (!hit) return false;
  await removeUserHookByKey({
    key: input.key,
    veylinHome: input.veylinHome,
    homeDir: input.homeDir,
  });
  await addUserHook({
    event: input.event ?? hit.event,
    matcher: input.matcher !== undefined ? input.matcher : hit.matcher,
    handler: input.handler ?? hit.handler,
    veylinHome: input.veylinHome,
    homeDir: input.homeDir,
  });
  return true;
}
