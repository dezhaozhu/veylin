#!/usr/bin/env node
/**
 * Release build with updater signing when ~/.tauri/veylin.key exists.
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const keyPath = join(homedir(), '.tauri', 'veylin.key');

const env = { ...process.env };
if (existsSync(keyPath) && !env.TAURI_SIGNING_PRIVATE_KEY) {
  env.TAURI_SIGNING_PRIVATE_KEY = keyPath;
}

execSync('tauri build', {
  cwd: desktopRoot,
  stdio: 'inherit',
  env,
});
