import { getTenantSettingsRow, upsertTenantSettings } from '@veylin/db';
import { setRuntimeModelOverrides, type RuntimeModelOverrides } from '@veylin/runtime';

export type ModelSettingsInput = {
  openaiApiKeyEnabled?: boolean;
  openaiApiKey?: string;
  overrideOpenAIBaseUrl?: boolean;
  openaiBaseUrl?: string;
};

export type ModelSettingsView = {
  openaiApiKeyEnabled: boolean;
  hasOpenaiApiKey: boolean;
  overrideOpenAIBaseUrl: boolean;
  openaiBaseUrl: string;
};

const DEFAULT_MODEL_SETTINGS: Required<Omit<RuntimeModelOverrides, 'openaiApiKey'>> & {
  openaiApiKey: string;
} = {
  openaiApiKeyEnabled: false,
  openaiApiKey: '',
  overrideOpenAIBaseUrl: false,
  openaiBaseUrl: '',
};

function normalize(settings: RuntimeModelOverrides | undefined): Required<RuntimeModelOverrides> {
  return {
    openaiApiKeyEnabled: settings?.openaiApiKeyEnabled === true,
    openaiApiKey: settings?.openaiApiKey ?? '',
    overrideOpenAIBaseUrl: settings?.overrideOpenAIBaseUrl === true,
    openaiBaseUrl: settings?.openaiBaseUrl ?? '',
  };
}

function toView(settings: Required<RuntimeModelOverrides>): ModelSettingsView {
  return {
    openaiApiKeyEnabled: settings.openaiApiKeyEnabled,
    hasOpenaiApiKey: settings.openaiApiKey.trim().length > 0,
    overrideOpenAIBaseUrl: settings.overrideOpenAIBaseUrl,
    openaiBaseUrl: settings.openaiBaseUrl,
  };
}

export async function getModelSettings(tenantId: string): Promise<ModelSettingsView> {
  const row = await getTenantSettingsRow(tenantId);
  return toView(normalize(row?.modelSettings));
}

export async function updateModelSettings(
  tenantId: string,
  patch: ModelSettingsInput,
): Promise<ModelSettingsView> {
  const existing = normalize((await getTenantSettingsRow(tenantId))?.modelSettings);
  const next = normalize({
    ...existing,
    ...(patch.openaiApiKeyEnabled !== undefined
      ? { openaiApiKeyEnabled: patch.openaiApiKeyEnabled }
      : {}),
    ...(patch.openaiApiKey !== undefined ? { openaiApiKey: patch.openaiApiKey } : {}),
    ...(patch.overrideOpenAIBaseUrl !== undefined
      ? { overrideOpenAIBaseUrl: patch.overrideOpenAIBaseUrl }
      : {}),
    ...(patch.openaiBaseUrl !== undefined ? { openaiBaseUrl: patch.openaiBaseUrl } : {}),
  });
  await upsertTenantSettings(tenantId, { modelSettings: next });
  applyModelSettingsToRuntime(next);
  return toView(next);
}

export async function applyTenantModelSettings(tenantId: string): Promise<void> {
  const row = await getTenantSettingsRow(tenantId);
  applyModelSettingsToRuntime(normalize(row?.modelSettings));
}

function applyModelSettingsToRuntime(settings: Required<RuntimeModelOverrides>): void {
  setRuntimeModelOverrides({
    ...DEFAULT_MODEL_SETTINGS,
    ...settings,
  });
}
