#!/usr/bin/env node
/**
 * Ensure sidecar is built for the host triple before `tauri dev`.
 * Keeps dev UX identical to the packaged app (no separate server terminal).
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const hostTriple = execSync('rustc --print host-tuple', { encoding: 'utf8' }).trim();
const sidecarRoot = resolve(repoRoot, 'apps/server/dist/sidecar');
const stampPath = resolve(sidecarRoot, '.target-triple');
const nodePath =
  process.platform === 'win32'
    ? resolve(sidecarRoot, 'node-runtime/node.exe')
    : resolve(sidecarRoot, 'node-runtime/bin/node');
const launcherPath = resolve(repoRoot, `apps/desktop/src-tauri/binaries/veylin-server-${hostTriple}`);

function nodeRuns(path) {
  if (!existsSync(path)) return false;
  const result = spawnSync(path, ['-v'], { stdio: 'ignore' });
  return result.status === 0;
}

const stampedTriple = existsSync(stampPath) ? readFileSync(stampPath, 'utf8').trim() : '';
const sidecarReady =
  stampedTriple === hostTriple &&
  existsSync(launcherPath) &&
  existsSync(resolve(sidecarRoot, 'server.mjs')) &&
  nodeRuns(nodePath);

if (!sidecarReady) {
  console.log(`[desktop] building sidecar for ${hostTriple} (one-time, ~1-2 min)...`);
  execSync('npm run -w @veylin/server build:sidecar', {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, CARGO_BUILD_TARGET: hostTriple },
  });
}
