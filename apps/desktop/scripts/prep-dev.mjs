#!/usr/bin/env node
/**
 * Dev-only: free Vite :5174; reclaim :8787 only when the owned server is not healthy.
 * Set VEYLIN_DEV_KILL_PORTS=0 to skip entirely.
 */
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

if (process.env.VEYLIN_DEV_KILL_PORTS === '0') {
  process.exit(0);
}

const ports = (process.env.VEYLIN_DEV_KILL_PORTS ?? '5174,8787')
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean);

const dataDir = resolveDevDataDir();
console.log(`[prep-dev] VEYLIN_DATA_DIR=${dataDir}`);

const pid = readPidFile(watchdogPidPath(dataDir));
const owned = pid != null && isLiveRepoWatchdog(pid, repoRoot);
const healthy = await probeVeylinHealth(healthUrl);

if (ports.includes('8787') && owned && healthy) {
  console.log(`[prep-dev] keeping healthy server on :${port} (watchdog pid=${pid})`);
  killRepoWatchdogsByCommand(repoRoot, { log: console.log, keepPid: pid });
} else if (ports.includes('8787')) {
  reclaimDevServerSingleton({
    dataDir,
    repoRoot,
    port,
    log: console.log,
  });
  killRepoWatchdogsByCommand(repoRoot, { log: console.log });
}

for (const p of ports) {
  if (p === '8787') continue;
  killPortListener(p);
}
