#!/usr/bin/env node
/** Cross-platform `npm run dev` — sets repo env vars without Unix-only shell syntax. */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const concurrently = resolve(repoRoot, 'node_modules/concurrently/dist/bin/concurrently.js');
const env = {
  ...process.env,
  VEYLIN_REPO_ROOT: repoRoot,
  VEYLIN_DATA_DIR: process.env.VEYLIN_DATA_DIR ?? './data',
};

const child = spawn(
  process.execPath,
  [
    concurrently,
    '-n',
    'server,web',
    '-c',
    'blue,green',
    'npm run dev:server',
    'npm run dev:web',
  ],
  { cwd: repoRoot, env, stdio: 'inherit', shell: false },
);

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
