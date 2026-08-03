#!/usr/bin/env node
/**
 * Dev-only: keep apps/server running on :8787 with tsx, restart on crash, log to data/logs/.
 * Spawned detached by ensure-server.mjs during desktop/web dev (VEYLIN_SKIP_SIDECAR=1).
 */
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  removePidFile,
  watchdogPidPath,
  writePidFile,
} from './server-dev-singleton.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const serverRoot = resolve(repoRoot, 'apps/server');
const port = process.env.PORT ?? '8787';
const healthUrl = `http://127.0.0.1:${port}/health`;

function resolveDevDataDir() {
  const raw = process.env.VEYLIN_DATA_DIR?.trim();
  if (!raw) return resolve(repoRoot, 'data');
  return isAbsolute(raw) ? raw : resolve(repoRoot, raw);
}

const dataDir = resolveDevDataDir();
const catalogPath = resolve(repoRoot, 'data/models.local.json');
const logDir = resolve(dataDir, 'logs');
const logPath = resolve(logDir, 'server-dev.log');
const pidFile = watchdogPidPath(dataDir);

mkdirSync(logDir, { recursive: true });
writePidFile(pidFile, process.pid);

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

let shuttingDown = false;
let child = null;
let restartTimer = null;

function writeLog(chunk) {
  appendFileSync(logPath, chunk);
}

function logLine(message) {
  const line = `[run-server-dev ${new Date().toISOString()}] ${message}\n`;
  process.stdout.write(line);
  writeLog(line);
}

async function probe() {
  try {
    const res = await fetch(healthUrl, { cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

function tsxCommand(repoRootPath) {
  const ext = process.platform === 'win32' ? '.cmd' : '';
  return resolve(repoRootPath, `node_modules/.bin/tsx${ext}`);
}

function spawnServer() {
  if (shuttingDown) return;
  logLine(`starting tsx watch server on :${port} (log: ${logPath})`);
  child = spawn(tsxCommand(repoRoot), ['watch', 'src/server.ts'], {
    cwd: serverRoot,
    env: serverEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });

  child.stdout?.on('data', writeLog);
  child.stderr?.on('data', writeLog);

  child.on('exit', (code, signal) => {
    child = null;
    if (shuttingDown) return;
    logLine(`server exited (code=${code ?? 'null'}, signal=${signal ?? 'null'}); restarting in 1s`);
    restartTimer = setTimeout(() => {
      restartTimer = null;
      spawnServer();
    }, 1_000);
  });
}

function shutdown() {
  shuttingDown = true;
  if (restartTimer) clearTimeout(restartTimer);
  if (child && !child.killed) {
    child.kill('SIGTERM');
  }
  removePidFile(pidFile);
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

logLine(`watchdog pid=${process.pid} dataDir=${dataDir} pidFile=${pidFile}`);
spawnServer();

async function watchHealth() {
  while (!shuttingDown) {
    await new Promise((r) => setTimeout(r, 5_000));
    if (shuttingDown || child == null) continue;
    if (!(await probe())) {
      logLine('health probe failed while child alive; waiting for restart loop');
    }
  }
}

void watchHealth();
