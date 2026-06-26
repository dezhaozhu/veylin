import { getTenantSettingsRow, upsertTenantSettings } from '@veylin/db';
import {
  isModelProviderConfigured,
  setRuntimeModelOverrides,
} from '@veylin/runtime';

export type ModelSettingsInput = {
  modelName?: string;
  requestUrl?: string;
  apiKey?: string;
};

export type ModelSettingsView = {
  modelName: string;
  requestUrl: string;
  hasApiKey: boolean;
  configured: boolean;
};

type StoredModelSettings = {
  modelName: string;
  requestUrl: string;
  apiKey: string;
};

/** Legacy rows persisted before the modelName / requestUrl / apiKey schema. */
type RawModelSettings = Partial<StoredModelSettings> & {
  providerName?: string;
  openaiApiKeyEnabled?: boolean;
  openaiApiKey?: string;
  overrideOpenAIBaseUrl?: boolean;
  openaiBaseUrl?: string;
};

const EMPTY_STORED: StoredModelSettings = {
  modelName: '',
  requestUrl: '',
  apiKey: '',
};

function normalize(raw: RawModelSettings | undefined): StoredModelSettings {
  const source = raw ?? {};
  const legacyApiKey =
    source.openaiApiKeyEnabled === true && typeof source.openaiApiKey === 'string'
      ? source.openaiApiKey
      : '';
  const legacyRequestUrl =
    source.overrideOpenAIBaseUrl === true && typeof source.openaiBaseUrl === 'string'
      ? source.openaiBaseUrl
      : '';
  const modelName =
    typeof source.modelName === 'string'
      ? source.modelName
      : typeof source.providerName === 'string'
        ? source.providerName
        : '';

  return {
    modelName,
    requestUrl: typeof source.requestUrl === 'string' ? source.requestUrl : legacyRequestUrl,
    apiKey: typeof source.apiKey === 'string' ? source.apiKey : legacyApiKey,
  };
}

function toView(settings: StoredModelSettings): ModelSettingsView {
  return {
    modelName: settings.modelName,
    requestUrl: settings.requestUrl,
    hasApiKey: settings.apiKey.trim().length > 0,
    configured: isModelProviderConfigured(settings),
  };
}

async function loadStoredSettings(tenantId: string): Promise<StoredModelSettings> {
  const row = await getTenantSettingsRow(tenantId);
  const raw = row?.modelSettings as RawModelSettings | undefined;
  return normalize(raw);
}

export async function getModelSettings(tenantId: string): Promise<ModelSettingsView> {
  const stored = await loadStoredSettings(tenantId);
  applyModelSettingsToRuntime(stored);
  return toView(stored);
}

export async function clearModelSettings(tenantId: string): Promise<ModelSettingsView> {
  await upsertTenantSettings(tenantId, { modelSettings: EMPTY_STORED });
  applyModelSettingsToRuntime(EMPTY_STORED);
  return toView(EMPTY_STORED);
}

export async function updateModelSettings(
  tenantId: string,
  patch: ModelSettingsInput,
): Promise<ModelSettingsView> {
  const existing = await loadStoredSettings(tenantId);
  const next = normalize({
    ...existing,
    ...(patch.modelName !== undefined ? { modelName: patch.modelName } : {}),
    ...(patch.requestUrl !== undefined ? { requestUrl: patch.requestUrl } : {}),
    ...(patch.apiKey !== undefined ? { apiKey: patch.apiKey } : {}),
  });
  await upsertTenantSettings(tenantId, { modelSettings: next });
  applyModelSettingsToRuntime(next);
  return toView(next);
}

export async function applyTenantModelSettings(tenantId: string): Promise<void> {
  const stored = await loadStoredSettings(tenantId);
  applyModelSettingsToRuntime(stored);
}

function applyModelSettingsToRuntime(settings: StoredModelSettings): void {
  setRuntimeModelOverrides({ ...EMPTY_STORED, ...settings });
}
