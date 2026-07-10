#!/usr/bin/env node
/**
 * Ensure the BFF sidecar is listening before Tauri opens the webview.
 * Desktop dev (VEYLIN_SKIP_SIDECAR=1): tsx + watchdog (current source, auto-restart).
 * Production / bundled dev: apps/server/dist/sidecar.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeVeylinHealth } from './health-probe.mjs';
import {
  isLiveRepoWatchdog,
  killPortListener,
  killRepoWatchdogsByCommand,
  readPidFile,
  reclaimDevServerSingleton,
  watchdogPidPath,
} from './server-dev-singleton.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '../../..');
const port = process.env.PORT ?? '8787';
const healthUrl = `http://127.0.0.1:${port}/health`;

function resolveDevDataDir() {
  const raw = process.env.VEYLIN_DATA_DIR?.trim();
  if (!raw) return resolve(repoRoot, 'data');
  return isAbsolute(raw) ? raw : resolve(repoRoot, raw);
}

const dataDir = resolveDevDataDir();
const catalogPath = resolve(repoRoot, 'data/models.local.json');
const distRoot = resolve(repoRoot, 'apps/server/dist/sidecar');

async function probe() {
  return probeVeylinHealth(healthUrl);
}

/** Dev tsx servers started before route refactors may answer /health but miss newer APIs. */
async function probeDevRoutes() {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/rag/local-models`, { cache: 'no-store' });
    return res.status !== 404;
  } catch {
    return false;
  }
}

function sidecarNode() {
  const distNode = resolve(distRoot, 'node-runtime/bin/node');
  if (existsSync(distNode)) return distNode;
  const embedded = resolve(
    repoRoot,
    'apps/desktop/src-tauri/target/debug/sidecar/node-runtime/bin/node',
  );
  if (existsSync(embedded)) return embedded;
  return process.execPath;
}

function sidecarEntry() {
  const distEntry = resolve(distRoot, 'server.mjs');
  if (existsSync(distEntry)) return distEntry;
  const debug = resolve(repoRoot, 'apps/desktop/src-tauri/target/debug/sidecar/server.mjs');
  if (existsSync(debug)) return debug;
  return distEntry;
}

async function waitForHealth(timeoutMs = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await probe()) return;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`sidecar did not become ready on :${port}`);
}

function sidecarBundleReady() {
  return (
    existsSync(resolve(distRoot, 'server.mjs')) &&
    existsSync(resolve(distRoot, 'node_modules/surrealdb/package.json'))
  );
}

function useDevTsxServer() {
  if (process.env.VEYLIN_USE_BUNDLED_SIDECAR === '1') return false;
  return process.env.VEYLIN_SKIP_SIDECAR === '1';
}

function spawnDevServerWatchdog(serverEnv) {
  const watchdog = resolve(scriptDir, 'run-server-dev.mjs');
  console.log(`[ensure-server] starting dev server watchdog (tsx) on :${port}...`);
  console.log(`[ensure-server] VEYLIN_DATA_DIR=${dataDir}`);
  const child = spawn(process.execPath, [watchdog], {
    env: serverEnv,
    stdio: 'ignore',
    detached: true,
  });
  child.unref();
}

/**
 * If health is already up, keep a single owned watchdog when possible.
 * Stale/missing routes or multi-watchdog mess → full reclaim + respawn.
 */
async function ensureOwnedDevServer(serverEnv) {
  const pidFile = watchdogPidPath(dataDir);
  const pid = readPidFile(pidFile);
  const owned = pid != null && isLiveRepoWatchdog(pid, repoRoot);
  const routesOk = await probeDevRoutes();

  if (owned && routesOk) {
    const extras = killRepoWatchdogsByCommand(repoRoot, { log: console.log, keepPid: pid });
    if (extras > 0) {
      console.log(`[ensure-server] removed ${extras} extra watchdog(s); keeping pid=${pid}`);
    }
    console.log(`[ensure-server] sidecar already ready on :${port} (watchdog pid=${pid})`);
    console.log(`[ensure-server] VEYLIN_DATA_DIR=${dataDir}`);
    return;
  }

  if (!routesOk) {
    console.log(`[ensure-server] stale or incomplete server on :${port}; reclaiming...`);
  } else if (!owned) {
    console.log(`[ensure-server] :${port} ready but watchdog not owned; reclaiming...`);
  }

  reclaimDevServerSingleton({ dataDir, repoRoot, port, log: console.log });
  await new Promise((r) => setTimeout(r, 400));
  spawnDevServerWatchdog(serverEnv);
  await waitForHealth();
  console.log(`[ensure-server] dev tsx server ready on :${port}`);
  console.log(`[ensure-server] VEYLIN_DATA_DIR=${dataDir}`);
}

async function main() {
  console.log(`[ensure-server] VEYLIN_DATA_DIR=${dataDir}`);

  const serverEnv = {
    ...process.env,
    VEYLIN_REPO_ROOT: repoRoot,
    VEYLIN_DATA_DIR: dataDir,
    VEYLIN_DESKTOP_AUTH: '1',
    VEYLIN_REQUIRE_USER_MODEL_SETTINGS: '1',
    VEYLIN_MODEL_CATALOG_PATH: catalogPath,
    VEYLIN_LAZY_MCP_BOOT: process.env.VEYLIN_LAZY_MCP_BOOT ?? '1',
    PORT: port,
  };

  if (useDevTsxServer()) {
    if (await probe()) {
      await ensureOwnedDevServer(serverEnv);
      return;
    }
    reclaimDevServerSingleton({ dataDir, repoRoot, port, log: console.log });
    await new Promise((r) => setTimeout(r, 400));
    spawnDevServerWatchdog(serverEnv);
    await waitForHealth();
    console.log(`[ensure-server] dev tsx server ready on :${port}`);
    return;
  }

  if (await probe()) {
    console.log(`[ensure-server] sidecar already ready on :${port}`);
    return;
  }

  const entry = sidecarEntry();
  if (!existsSync(entry)) {
    throw new Error(`sidecar entry not found: ${entry} (run build:sidecar first)`);
  }

  if (!sidecarBundleReady()) {
    const serverRoot = resolve(repoRoot, 'apps/server');
    const tsx = resolve(repoRoot, `node_modules/.bin/tsx${process.platform === 'win32' ? '.cmd' : ''}`);
    console.log(`[ensure-server] bundled sidecar incomplete — starting tsx server on :${port}...`);
    killPortListener(port);
    const child = spawn(tsx, ['src/server.ts'], {
      cwd: serverRoot,
      env: serverEnv,
      stdio: 'ignore',
      detached: true,
      shell: process.platform === 'win32',
    });
    child.unref();
    await waitForHealth();
    console.log(`[ensure-server] tsx server ready on :${port}`);
    return;
  }

  const node = sidecarNode();
  console.log(`[ensure-server] starting sidecar on :${port} (${entry})...`);
  killPortListener(port);
  const child = spawn(node, [entry], {
    cwd: dirname(entry),
    env: serverEnv,
    stdio: 'ignore',
    detached: true,
  });
  child.unref();

  await waitForHealth();
  console.log(`[ensure-server] sidecar ready on :${port}`);
}

main().catch((err) => {
  console.error('[ensure-server]', err instanceof Error ? err.message : err);
  process.exit(1);
});
