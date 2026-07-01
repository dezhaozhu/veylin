import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LOCAL_EMBEDDING_HF_MODEL_ID,
  LOCAL_EMBEDDING_ONNX_FILE,
  embeddingModelDir,
  ensureDataDir,
  isEmbeddingModelReady,
} from '@veylin/db';
import { generateLocalEmbeddings, resetLocalFastembedRuntime } from '@veylin/runtime';
import { buildHfResolveUrl, resolveHuggingfaceEndpoint } from './hf-endpoint';
import { downloadFile } from './hf-download';

export { LOCAL_EMBEDDING_HF_MODEL_ID as EMBEDDING_HF_MODEL_ID } from '@veylin/db';

const EMBEDDING_FILES: Array<{ remote: string; local: string }> = [
  { remote: 'onnx/model.onnx', local: LOCAL_EMBEDDING_ONNX_FILE },
  { remote: 'config.json', local: 'config.json' },
  { remote: 'tokenizer.json', local: 'tokenizer.json' },
  { remote: 'tokenizer_config.json', local: 'tokenizer_config.json' },
  { remote: 'special_tokens_map.json', local: 'special_tokens_map.json' },
  { remote: 'vocab.txt', local: 'vocab.txt' },
];

export type EmbeddingDownloadPhase = 'idle' | 'downloading' | 'ready' | 'error';

export type EmbeddingDownloadState = {
  phase: EmbeddingDownloadPhase;
  progress: number;
  message: string;
  error?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
};

export type EmbeddingStatus = {
  id: 'embedding';
  kind: 'embedding';
  required: true;
  modelId: string;
  installed: boolean;
  download: EmbeddingDownloadState;
  installedAt: string | null;
  lastError: string | null;
  hfEndpoint: string | null;
};

type StoredEmbeddingSettings = {
  installedAt?: string | null;
  lastError?: string | null;
};

const SETTINGS_FILE = 'embedding-settings.json';

let downloadState: EmbeddingDownloadState = {
  phase: 'idle',
  progress: 0,
  message: '',
  error: null,
};
let downloadPromise: Promise<void> | null = null;
let lastHfEndpoint: string | null = null;

function settingsPath(): string {
  return join(ensureDataDir(), SETTINGS_FILE);
}

function readSettings(): StoredEmbeddingSettings {
  const path = settingsPath();
  if (!existsSync(path)) {
    return { installedAt: null, lastError: null };
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<StoredEmbeddingSettings>;
    return {
      installedAt: typeof raw.installedAt === 'string' ? raw.installedAt : null,
      lastError: typeof raw.lastError === 'string' ? raw.lastError : null,
    };
  } catch {
    return { installedAt: null, lastError: null };
  }
}

function writeSettings(settings: StoredEmbeddingSettings): void {
  mkdirSync(ensureDataDir(), { recursive: true });
  writeFileSync(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

function updateDownloadState(patch: Partial<EmbeddingDownloadState>): void {
  downloadState = { ...downloadState, ...patch };
}

export async function getEmbeddingStatus(): Promise<EmbeddingStatus> {
  const settings = readSettings();
  let installedAt = settings.installedAt ?? null;
  let lastError = settings.lastError ?? downloadState.error ?? null;
  let installed = false;

  if (downloadState.phase === 'downloading') {
    installed = false;
  } else {
    installed = isEmbeddingModelReady();
    if (installed) {
      if (!installedAt) {
        installedAt = new Date().toISOString();
        writeSettings({ installedAt, lastError: null });
      }
      lastError = null;
    } else if (installedAt) {
      installedAt = null;
      writeSettings({ installedAt: null, lastError });
    }
  }

  const phase =
    downloadState.phase === 'downloading'
      ? 'downloading'
      : downloadState.phase === 'error'
        ? 'error'
        : installed
          ? 'ready'
          : 'idle';

  return {
    id: 'embedding',
    kind: 'embedding',
    required: true,
    modelId: LOCAL_EMBEDDING_HF_MODEL_ID,
    installed,
    download: {
      ...downloadState,
      phase,
      progress: phase === 'ready' ? 100 : downloadState.progress,
    },
    installedAt: installed ? installedAt : null,
    lastError,
    hfEndpoint: lastHfEndpoint,
  };
}

export function startEmbeddingDownload(): { ok: boolean; message?: string } {
  if (downloadPromise) {
    return { ok: true, message: 'already downloading' };
  }
  if (isEmbeddingModelReady()) {
    const settings = readSettings();
    writeSettings({
      installedAt: settings.installedAt ?? new Date().toISOString(),
      lastError: null,
    });
    updateDownloadState({ phase: 'ready', progress: 100, message: 'ready', error: null });
    return { ok: true, message: 'already installed' };
  }

  downloadPromise = (async () => {
    updateDownloadState({
      phase: 'downloading',
      progress: 0,
      message: 'resolve-endpoint',
      error: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    });

    const modelDir = embeddingModelDir();
    mkdirSync(modelDir, { recursive: true });

    try {
      const endpoint = await resolveHuggingfaceEndpoint();
      lastHfEndpoint = endpoint;
      const totalFiles = EMBEDDING_FILES.length;

      for (let index = 0; index < EMBEDDING_FILES.length; index++) {
        const entry = EMBEDDING_FILES[index]!;
        const dest = join(modelDir, entry.local);
        const url = buildHfResolveUrl(endpoint, LOCAL_EMBEDDING_HF_MODEL_ID, entry.remote);
        const baseProgress = Math.round((index / totalFiles) * 100);

        updateDownloadState({ message: entry.remote, progress: baseProgress });
        await downloadFile(url, dest, (loaded, total) => {
          const slice = total > 0 ? (loaded / total) * (100 / totalFiles) : 0;
          updateDownloadState({
            progress: Math.min(99, Math.round(baseProgress + slice)),
            message: entry.remote,
          });
        });
      }

      if (!isEmbeddingModelReady()) {
        throw new Error('Embedding model files missing after download');
      }

      writeFileSync(
        join(modelDir, '.hf-source.json'),
        `${JSON.stringify({ modelId: LOCAL_EMBEDDING_HF_MODEL_ID, endpoint }, null, 2)}\n`,
        'utf8',
      );

      const installedAt = new Date().toISOString();
      writeSettings({ installedAt, lastError: null });
      resetLocalFastembedRuntime();

      updateDownloadState({
        phase: 'ready',
        progress: 100,
        message: 'ready',
        error: null,
        finishedAt: installedAt,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      writeSettings({ ...readSettings(), installedAt: null, lastError: message });
      updateDownloadState({
        phase: 'error',
        progress: 0,
        message,
        error: message,
        finishedAt: new Date().toISOString(),
      });
    } finally {
      downloadPromise = null;
    }
  })();

  return { ok: true };
}

/** Kick off background download when the required embedding model is missing or incomplete. */
export function ensureEmbeddingModelOnStartup(): void {
  if (isEmbeddingModelReady()) return;
  const result = startEmbeddingDownload();
  if (result.ok) {
    console.info(
      '[embedding] required model missing or incomplete — auto-download started (VEYLIN_DATA_DIR=%s)',
      ensureDataDir(),
    );
  } else if (result.message) {
    console.warn('[embedding] auto-download not started:', result.message);
  }
}

export async function removeEmbeddingModel(): Promise<EmbeddingStatus> {
  if (downloadPromise) {
    throw new Error('Cannot remove embedding model while downloading');
  }
  const modelDir = embeddingModelDir();
  if (existsSync(modelDir)) rmSync(modelDir, { recursive: true, force: true });
  resetLocalFastembedRuntime();
  writeSettings({ installedAt: null, lastError: null });
  updateDownloadState({
    phase: 'idle',
    progress: 0,
    message: '',
    error: null,
    startedAt: null,
    finishedAt: null,
  });
  return getEmbeddingStatus();
}

export async function embedTextsIfInstalled(values: string[]): Promise<number[][] | null> {
  if (!isEmbeddingModelReady()) return null;
  try {
    return await generateLocalEmbeddings(values);
  } catch (err) {
    console.warn('[rag] embedding unavailable:', err);
    return null;
  }
}

export const __test__ = {
  EMBEDDING_FILES,
  readSettings,
  writeSettings,
  settingsPath,
  resetForTest: () => {
    downloadState = { phase: 'idle', progress: 0, message: '', error: null };
    downloadPromise = null;
    lastHfEndpoint = null;
    resetLocalFastembedRuntime();
  },
};
