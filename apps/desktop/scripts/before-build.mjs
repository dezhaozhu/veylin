#!/usr/bin/env node
/**
 * Cross-platform Tauri beforeBuildCommand (Windows cmd.exe cannot use VAR=value syntax).
 */
import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const hostTriple =
  process.env.CARGO_BUILD_TARGET ??
  process.env.TAURI_ENV_TARGET_TRIPLE ??
  execSync('rustc --print host-tuple', { encoding: 'utf8' }).trim();

execSync('npm run -w @veylin/web build', {
  cwd: repoRoot,
  stdio: 'inherit',
  env: { ...process.env, VITE_API_URL: 'http://127.0.0.1:8787' },
});

execSync('npm run -w @veylin/server build:sidecar', {
  cwd: repoRoot,
  stdio: 'inherit',
  env: { ...process.env, CARGO_BUILD_TARGET: hostTriple },
});
