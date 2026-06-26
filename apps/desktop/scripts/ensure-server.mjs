#!/usr/bin/env node
/**
 * Ensure the BFF sidecar is listening before Tauri opens the webview.
 * Avoids "本地服务暂未就绪" when the Rust sidecar spawn is slow or fails.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const port = process.env.PORT ?? '8787';
const healthUrl = `http://127.0.0.1:${port}/health`;
const dataDir =
  process.env.VEYLIN_DATA_DIR ??
  resolve(homedir(), 'Library/Application Support/com.veylin.app');
const catalogPath = resolve(repoRoot, 'data/models.local.json');

async function probe() {
  try {
    const res = await fetch(healthUrl, { cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

function sidecarNode() {
  const embedded = resolve(
    repoRoot,
    'apps/desktop/src-tauri/target/debug/sidecar/node-runtime/bin/node',
  );
  if (existsSync(embedded)) return embedded;
  return process.execPath;
}

function sidecarEntry() {
  const debug = resolve(repoRoot, 'apps/desktop/src-tauri/target/debug/sidecar/server.mjs');
  if (existsSync(debug)) return debug;
  return resolve(repoRoot, 'apps/server/dist/sidecar/server.mjs');
}

async function waitForHealth(timeoutMs = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await probe()) return;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`sidecar did not become ready on :${port}`);
}

async function main() {
  if (await probe()) {
    console.log(`[ensure-server] sidecar already ready on :${port}`);
    return;
  }

  const node = sidecarNode();
  const entry = sidecarEntry();
  if (!existsSync(entry)) {
    throw new Error(`sidecar entry not found: ${entry} (run build:sidecar first)`);
  }

  console.log(`[ensure-server] starting sidecar on :${port}...`);
  const child = spawn(node, [entry], {
    cwd: dirname(entry),
    env: {
      ...process.env,
      VEYLIN_DATA_DIR: dataDir,
      VEYLIN_DESKTOP_AUTH: '1',
      VEYLIN_REQUIRE_USER_MODEL_SETTINGS: '1',
      VEYLIN_MODEL_CATALOG_PATH: catalogPath,
      PORT: port,
    },
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
