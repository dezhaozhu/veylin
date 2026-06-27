import { getTenantSettingsRow, upsertTenantSettings } from '@veylin/db';
import {
  modelProviderSettingsPatchSchema,
  modelProviderSettingsSchema,
  type ModelProviderSettingsStored,
} from '@veylin/shared';
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

const EMPTY_STORED: ModelProviderSettingsStored = modelProviderSettingsSchema.parse({});

function normalize(raw: Partial<ModelProviderSettingsStored> | undefined): ModelProviderSettingsStored {
  const parsed = modelProviderSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : { ...EMPTY_STORED };
}

function toView(settings: ModelProviderSettingsStored): ModelSettingsView {
  return {
    modelName: settings.modelName,
    requestUrl: settings.requestUrl,
    hasApiKey: settings.apiKey.trim().length > 0,
    configured: isModelProviderConfigured(settings),
  };
}

async function loadStoredSettings(tenantId: string): Promise<ModelProviderSettingsStored> {
  const row = await getTenantSettingsRow(tenantId);
  const raw = row?.modelSettings as Partial<ModelProviderSettingsStored> | undefined;
  return normalize(raw);
}

export async function getModelSettings(tenantId: string): Promise<ModelSettingsView> {
  const stored = await loadStoredSettings(tenantId);
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
  const parsedPatch = modelProviderSettingsPatchSchema.safeParse(patch);
  if (!parsedPatch.success) {
    throw new Error('Invalid model settings payload');
  }
  const existing = await loadStoredSettings(tenantId);
  const next = normalize({ ...existing, ...parsedPatch.data });
  await upsertTenantSettings(tenantId, { modelSettings: next });
  applyModelSettingsToRuntime(next);
  return toView(next);
}

export async function applyTenantModelSettings(tenantId: string): Promise<void> {
  const stored = await loadStoredSettings(tenantId);
  applyModelSettingsToRuntime(stored);
}

function applyModelSettingsToRuntime(settings: ModelProviderSettingsStored): void {
  setRuntimeModelOverrides({ ...settings });
}
