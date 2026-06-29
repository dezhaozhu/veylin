#!/usr/bin/env node
/**
 * Dev-only: free 5174/8787 so Vite + sidecar are not blocked by zombie processes.
 * Set VEYLIN_DEV_KILL_PORTS=0 to skip.
 */
import { execSync } from 'node:child_process';
import { platform } from 'node:os';

function killPort(port) {
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
          // already gone
        }
      }
    } catch {
      // nothing listening
    }
    return;
  }

  try {
    execSync(`lsof -ti :${port} 2>/dev/null | xargs kill -9 2>/dev/null`, {
      stdio: 'ignore',
    });
  } catch {
    // nothing listening
  }
}

const ports = (process.env.VEYLIN_DEV_KILL_PORTS ?? '5174,8787')
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean);

if (process.env.VEYLIN_DEV_KILL_PORTS === '0') {
  process.exit(0);
}

for (const port of ports) {
  killPort(port);
}
