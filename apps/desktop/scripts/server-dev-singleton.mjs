/**
 * Shared helpers for desktop-dev server watchdog single-instance.
 * Pure helpers are unit-tested; process kill helpers are used by prep/ensure/run scripts.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { platform } from 'node:os';

export const WATCHDOG_PID_BASENAME = 'server-dev-watchdog.pid';

/** @param {string} dataDir */
export function watchdogPidPath(dataDir) {
  return resolve(dataDir, 'logs', WATCHDOG_PID_BASENAME);
}

/**
 * @param {string} raw
 * @returns {number | null}
 */
export function parseWatchdogPid(raw) {
  const n = Number(String(raw ?? '').trim());
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

/**
 * True when `cmdline` looks like this repo's run-server-dev.mjs.
 * @param {string} cmdline
 * @param {string} repoRoot
 */
export function isRepoWatchdogCommand(cmdline, repoRoot) {
  if (!cmdline || !repoRoot) return false;
  const norm = cmdline.replace(/\\/g, '/');
  const root = repoRoot.replace(/\\/g, '/').replace(/\/$/, '');
  return norm.includes('run-server-dev.mjs') && norm.includes(root);
}

function sleepMs(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* spin */
  }
}

/**
 * @param {number} pid
 * @returns {string}
 */
export function readProcessCommandLine(pid) {
  if (platform() === 'win32') {
    try {
      const out = execSync(
        `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"ProcessId=${pid}\\").CommandLine"`,
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] },
      ).trim();
      return out;
    } catch {
      return '';
    }
  }
  try {
    return execSync(`ps -p ${pid} -o command=`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

/**
 * @param {number} pid
 * @param {string} repoRoot
 */
export function isLiveRepoWatchdog(pid, repoRoot) {
  const cmd = readProcessCommandLine(pid);
  return isRepoWatchdogCommand(cmd, repoRoot);
}

/**
 * @param {string} pidFile
 * @returns {number | null}
 */
export function readPidFile(pidFile) {
  if (!existsSync(pidFile)) return null;
  try {
    return parseWatchdogPid(readFileSync(pidFile, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * @param {string} pidFile
 * @param {number} pid
 */
export function writePidFile(pidFile, pid) {
  mkdirSync(dirname(pidFile), { recursive: true });
  writeFileSync(pidFile, `${pid}\n`, 'utf8');
}

/** @param {string} pidFile */
export function removePidFile(pidFile) {
  try {
    if (existsSync(pidFile)) unlinkSync(pidFile);
  } catch {
    /* ignore */
  }
}

/**
 * @param {number} pid
 * @param {NodeJS.Signals | number} signal
 */
export function tryKill(pid, signal = 'SIGTERM') {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

/**
 * Kill a live repo watchdog from a pid file, then remove the file.
 * @param {string} dataDir
 * @param {string} repoRoot
 * @param {{ log?: (msg: string) => void }} [opts]
 */
export function stopWatchdogFromPidFile(dataDir, repoRoot, opts = {}) {
  const log = opts.log ?? (() => {});
  const pidFile = watchdogPidPath(dataDir);
  const pid = readPidFile(pidFile);
  if (pid == null) {
    removePidFile(pidFile);
    return false;
  }
  if (!isLiveRepoWatchdog(pid, repoRoot)) {
    log(`[watchdog] stale pid file ${pidFile} (pid=${pid}); removing`);
    removePidFile(pidFile);
    return false;
  }
  log(`[watchdog] stopping existing run-server-dev pid=${pid}`);
  tryKill(pid, 'SIGTERM');
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
      sleepMs(100);
    } catch {
      break;
    }
  }
  try {
    process.kill(pid, 0);
    tryKill(pid, 'SIGKILL');
  } catch {
    /* gone */
  }
  removePidFile(pidFile);
  return true;
}

/**
 * Kill all run-server-dev.mjs processes whose cmdline references this repo.
 * @param {string} repoRoot
 * @param {{ log?: (msg: string) => void, keepPid?: number | null }} [opts]
 */
export function killRepoWatchdogsByCommand(repoRoot, opts = {}) {
  const log = opts.log ?? (() => {});
  const keepPid = opts.keepPid ?? null;
  if (platform() === 'win32') {
    // Best-effort: rely on pid file + port kill on Windows.
    return 0;
  }
  let killed = 0;
  try {
    const out = execSync('pgrep -f run-server-dev\\.mjs || true', {
      encoding: 'utf8',
      shell: true,
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    if (!out) return 0;
    for (const raw of out.split(/\s+/)) {
      const pid = Number(raw);
      if (!Number.isInteger(pid) || pid <= 0) continue;
      if (pid === process.pid) continue;
      if (keepPid != null && pid === keepPid) continue;
      if (!isLiveRepoWatchdog(pid, repoRoot)) continue;
      log(`[watchdog] killing repo run-server-dev pid=${pid}`);
      tryKill(pid, 'SIGTERM');
      killed += 1;
    }
  } catch {
    /* ignore */
  }
  return killed;
}

/**
 * @param {string | number} listenPort
 */
export function killPortListener(listenPort) {
  const port = String(listenPort);
  if (platform() === 'win32') {
    try {
      const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
      const pids = new Set(
        out
          .split('\n')
          .map((line) => line.trim().split(/\s+/).pop())
          .filter((pid) => pid && /^\d+$/.test(pid)),
      );
      for (const pid of pids) {
        try {
          execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
        } catch {
          /* gone */
        }
      }
    } catch {
      /* nothing */
    }
    return;
  }
  try {
    execSync(`lsof -ti :${port} 2>/dev/null | xargs kill -9 2>/dev/null`, {
      stdio: 'ignore',
      shell: true,
    });
  } catch {
    /* nothing */
  }
}

/**
 * Converge to zero watchdogs for this repo before spawning a new one.
 * @param {{ dataDir: string, repoRoot: string, port?: string | number, log?: (msg: string) => void }} opts
 */
export function reclaimDevServerSingleton(opts) {
  const { dataDir, repoRoot, port = 8787, log = console.log } = opts;
  stopWatchdogFromPidFile(dataDir, repoRoot, { log });
  killRepoWatchdogsByCommand(repoRoot, { log });
  killPortListener(port);
}
