#!/usr/bin/env node
/** Cross-platform desktop dev — sets VEYLIN_SKIP_SIDECAR without Unix-only shell syntax. */
import { spawnSync, spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, '..');
const repoRoot = resolve(desktopRoot, '../..');

const devEnv = {
  ...process.env,
  VEYLIN_SKIP_SIDECAR: '1',
  VEYLIN_REPO_ROOT: process.env.VEYLIN_REPO_ROOT ?? repoRoot,
  VEYLIN_DATA_DIR: process.env.VEYLIN_DATA_DIR ?? resolve(repoRoot, 'data'),
};

function runNode(scriptName, envPatch = {}) {
  const scriptPath = resolve(scriptDir, scriptName);
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: desktopRoot,
    env: { ...devEnv, ...envPatch },
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

runNode('prep-dev.mjs');
// Tauri compile still needs externalBin on disk; runtime uses tsx via VEYLIN_SKIP_SIDECAR.
runNode('ensure-sidecar.mjs', { VEYLIN_SKIP_SIDECAR: '0' });
runNode('ensure-server.mjs');

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const child = spawn(npmCmd, ['run', 'tauri', '--', 'dev'], {
  cwd: desktopRoot,
  env: devEnv,
  stdio: 'inherit',
  shell: true,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
