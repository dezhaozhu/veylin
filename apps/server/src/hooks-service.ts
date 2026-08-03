import { homedir } from 'node:os';
import {
  HookBus,
  loadAllHooks,
  hookIdentityKey,
  addUserHook,
  removeUserHookByKey,
  updateUserHookByKey,
  type LoadedHookHandler,
  type HookLogEntry,
  type McpToolCaller,
  type PromptEvaluator,
  type AgentEvaluator,
  type HookEvent,
  type HookHandler,
} from '@veylin/hooks';
import {
  getDisabledHooks,
  getImportClaudeHooks,
  getWorkspaceRootSetting,
  setDisabledHooks,
} from './veylin-settings-file.js';
import { createAgentHookEvaluator, createPromptHookEvaluator } from './hook-evaluators.js';
import { veylinHome } from './veylin-paths.js';

const buses = new Map<string, HookBus>();

export type PluginHookSource = { id: string; root: string };

let pluginSourcesProvider: ((tenantId: string) => Promise<PluginHookSource[]>) | null = null;

export function setPluginHookSourcesProvider(
  provider: ((tenantId: string) => Promise<PluginHookSource[]>) | null,
): void {
  pluginSourcesProvider = provider;
}

export function getHookBus(tenantId: string): HookBus {
  let bus = buses.get(tenantId);
  if (!bus) {
    bus = new HookBus({
      dataDir: process.env.VEYLIN_DATA_DIR,
      failClosedOnTimeout: process.env.VEYLIN_HOOKS_FAIL_CLOSED === '1',
      evaluatePrompt: createPromptHookEvaluator(),
      evaluateAgent: createAgentHookEvaluator(),
    });
    buses.set(tenantId, bus);
  }
  return bus;
}

export async function reloadHooksForTenant(
  tenantId: string,
  extras?: {
    callMcpTool?: McpToolCaller;
    evaluatePrompt?: PromptEvaluator;
    evaluateAgent?: AgentEvaluator;
    onAsyncRewake?: (info: { stderr: string; event: string; threadId?: string }) => void;
  },
): Promise<LoadedHookHandler[]> {
  const workspaceRoot = await getWorkspaceRootSetting(tenantId);
  const plugins = pluginSourcesProvider ? await pluginSourcesProvider(tenantId) : [];
  const disabledList = await getDisabledHooks(tenantId);
  const handlers = await loadAllHooks({
    workspaceRoot,
    homeDir: homedir(),
    veylinHome: veylinHome(),
    importClaudeHooks: await getImportClaudeHooks(tenantId),
    plugins,
    disabledKeys: new Set(disabledList),
  });
  const bus = getHookBus(tenantId);
  bus.updateOptions({
    workspaceRoot,
    dataDir: process.env.VEYLIN_DATA_DIR,
    evaluatePrompt: extras?.evaluatePrompt ?? createPromptHookEvaluator(),
    evaluateAgent: extras?.evaluateAgent ?? createAgentHookEvaluator(),
    callMcpTool: extras?.callMcpTool,
    onAsyncRewake: extras?.onAsyncRewake,
  });
  bus.setHandlers(handlers);
  return handlers;
}

export async function setHookDisabled(
  tenantId: string,
  key: string,
  disabled: boolean,
): Promise<void> {
  const current = await getDisabledHooks(tenantId);
  const next = new Set(current);
  if (disabled) next.add(key);
  else next.delete(key);
  await setDisabledHooks(tenantId, [...next]);
}

export async function createUserHook(
  tenantId: string,
  input: { event: HookEvent; matcher?: string; handler: HookHandler },
): Promise<LoadedHookHandler[]> {
  await addUserHook({
    ...input,
    homeDir: homedir(),
    veylinHome: veylinHome(),
  });
  return reloadHooksForTenant(tenantId);
}

export async function updateUserHook(
  tenantId: string,
  key: string,
  patch: { event?: HookEvent; matcher?: string; handler?: HookHandler },
): Promise<boolean> {
  const ok = await updateUserHookByKey({
    key,
    ...patch,
    homeDir: homedir(),
    veylinHome: veylinHome(),
  });
  if (ok) await reloadHooksForTenant(tenantId);
  return ok;
}

export async function deleteUserHook(tenantId: string, key: string): Promise<boolean> {
  const ok = await removeUserHookByKey({
    key,
    homeDir: homedir(),
    veylinHome: veylinHome(),
  });
  if (ok) {
    const disabled = await getDisabledHooks(tenantId);
    if (disabled.includes(key)) {
      await setDisabledHooks(
        tenantId,
        disabled.filter((k) => k !== key),
      );
    }
    await reloadHooksForTenant(tenantId);
  }
  return ok;
}

export function listHookLogs(tenantId: string, limit = 50): HookLogEntry[] {
  return getHookBus(tenantId).getLogs(limit);
}

export { hookIdentityKey };
