#!/usr/bin/env node
/**
 * Cross-platform `npm run dev`:
 * 1. Optionally free dev ports (8787, 5174)
 * 2. Start backend and wait until /health is ready
 * 3. Start Vite (avoids proxy ECONNREFUSED spam during SurrealDB init)
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanDevPorts, waitForServerHealth } from './dev-utils.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const env = {
  ...process.env,
  VEYLIN_REPO_ROOT: repoRoot,
  VEYLIN_DATA_DIR: process.env.VEYLIN_DATA_DIR ?? './data',
  // Dev-only: faster cold start; chat still calls ensureMcpForTenant on demand.
  VEYLIN_LAZY_MCP_BOOT: process.env.VEYLIN_LAZY_MCP_BOOT ?? '1',
  // Dev-only: reload agent.yaml from disk on each chat; customize APIs always force-sync.
  VEYLIN_HOT_RELOAD_AGENTS: process.env.VEYLIN_HOT_RELOAD_AGENTS ?? '1',
  VITE_VEYLIN_DESKTOP_AUTH: process.env.VEYLIN_DESKTOP_AUTH ?? '1',
};

const children = [];

function spawnNpm(script, label) {
  const child = spawn(npmCmd, ['run', script], {
    cwd: repoRoot,
    env,
    stdio: 'inherit',
    shell: true,
  });
  child.on('exit', (code, signal) => {
    if (signal) {
      shutdown(signal);
      return;
    }
    if (code && code !== 0) shutdown(code);
  });
  children.push({ child, label });
  return child;
}

function shutdown(codeOrSignal = 0) {
  for (const { child, label } of children) {
    if (child.killed || child.exitCode != null) continue;
    try {
      child.kill('SIGTERM');
    } catch {
      console.warn(`[dev] failed to stop ${label}`);
    }
  }
  if (typeof codeOrSignal === 'string') {
    process.kill(process.pid, codeOrSignal);
    return;
  }
  process.exit(codeOrSignal);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

if (process.env.VEYLIN_DEV_CLEAN_PORTS !== '0') {
  cleanDevPorts();
}

console.log('[dev] starting server…');
spawnNpm('dev:server', 'server');

try {
  await waitForServerHealth();
  console.log('[dev] server ready — starting web on :5174');
} catch (err) {
  console.error('[dev]', err instanceof Error ? err.message : err);
  shutdown(1);
}

spawnNpm('dev:web', 'web');
