/**
 * 「像用户那样走一遍」的隔离跑法。
 *
 * 默认的 playwright.config.ts 会 **reuseExistingServer 复用 :8787**,也就是用户
 * 正在用的那个实例和那份真实数据 —— 我曾经就是这样把一条真线程写坏了。这份
 * 配置把整栈另起一套:自己的端口、自己的数据目录,跑完删掉都行。
 *
 * 模型仍然是真的(仓库根 .env 里的网关),因为今天那两个 bug —— 附件在第二轮
 * 毒死对话、空轮次静默 —— **只有真跑两轮对话才会显形**。
 *
 * 跑:  npx playwright test -c playwright.isolated.config.ts
 */
import { defineConfig, devices } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const API_PORT = process.env.E2E_API_PORT ?? '8799';
const WEB_PORT = process.env.E2E_WEB_PORT ?? '5175';
const API = `http://127.0.0.1:${API_PORT}`;
const baseURL = `http://localhost:${WEB_PORT}`;

// 每次跑一个新目录 —— 上一轮的项目/线程不会污染这一轮的断言。
const dataDir = process.env.E2E_DATA_DIR ?? mkdtempSync(resolve(tmpdir(), 'veylin-e2e-'));

export default defineConfig({
  testDir: './e2e',
  testMatch: /project-journey\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  // 真模型 + 真附件抽取,一轮对话几十秒起步。
  timeout: 15 * 60_000,
  use: {
    baseURL,
    trace: 'retain-on-failure',
    actionTimeout: 30_000,
    // 桌面端真实窗口大小。默认的 1280×720 里右栏的开关会被挤到视口外,
    // 点不到 —— 那是测试环境的假故障,不是产品的。
    viewport: { width: 1600, height: 1000 },
  },
  // 视口写在 project 里:devices['Desktop Chrome'] 自带 1280×720,
  // 放在顶层 use 会被它盖回去(白排查了一轮)。
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 1000 } },
    },
  ],
  webServer: [
    {
      command: 'npx tsx apps/server/src/server.ts',
      cwd: repoRoot,
      url: `${API}/health`,
      reuseExistingServer: true,
      timeout: 180_000,
      stdout: 'ignore',
      stderr: 'pipe',
      env: {
        PORT: API_PORT,
        VEYLIN_DATA_DIR: dataDir,
        VEYLIN_DESKTOP_AUTH: '1',
        VEYLIN_LAZY_MCP_BOOT: '1',
      },
    },
    {
      command: `npm run dev -- --port ${WEB_PORT} --strictPort`,
      cwd: resolve(repoRoot, 'apps/web'),
      url: baseURL,
      reuseExistingServer: true,
      timeout: 180_000,
      env: { VITE_API_URL: API },
    },
  ],
});
