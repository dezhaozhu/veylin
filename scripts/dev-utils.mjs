#!/usr/bin/env node
/** Shared helpers for local dev scripts (cross-platform). */
import { execSync } from 'node:child_process';

export const DEV_PORTS = [8787, 5174];
export const DEFAULT_HEALTH_URL = 'http://127.0.0.1:8787/health';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function killPort(port) {
  if (process.platform === 'win32') {
    try {
      const lines = execSync(`netstat -ano | findstr ":${port}" | findstr LISTENING`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      })
        .trim()
        .split('\n')
        .filter(Boolean);
      const pids = new Set();
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && /^\d+$/.test(pid)) pids.add(pid);
      }
      for (const pid of pids) {
        try {
          execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
        } catch {
          /* already gone */
        }
      }
    } catch {
      /* nothing listening */
    }
    return;
  }

  try {
    execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`, {
      shell: true,
      stdio: 'ignore',
    });
  } catch {
    /* nothing listening */
  }
}

export function cleanDevPorts(ports = DEV_PORTS) {
  for (const port of ports) {
    killPort(port);
  }
}

export function isHealthReady(payload) {
  return payload?.ok === true && payload?.db?.ready === true;
}

export async function waitForServerHealth(
  url = DEFAULT_HEALTH_URL,
  { timeoutMs = 120_000, intervalMs = 400 } = {},
) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'unknown';

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) {
        const body = await res.json();
        if (isHealthReady(body)) return body;
        lastError = 'health not ready yet';
      } else {
        lastError = `HTTP ${res.status}`;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await sleep(intervalMs);
  }

  throw new Error(`Timed out waiting for ${url} (${lastError})`);
}
