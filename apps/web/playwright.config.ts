import { defineConfig, devices } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5174';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
  timeout: 60_000,
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'node apps/desktop/scripts/ensure-server.mjs',
      cwd: repoRoot,
      url: 'http://127.0.0.1:8787/health',
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        VEYLIN_DESKTOP_AUTH: '1',
        VEYLIN_DATA_DIR: './data',
        // CI/smoke has no prebuilt sidecar; use the same tsx path as desktop dev.
        VEYLIN_SKIP_SIDECAR: '1',
        VEYLIN_LAZY_MCP_BOOT: '1',
      },
    },
    {
      command: 'npm run dev',
      url: baseURL,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
