#!/usr/bin/env node
/**
 * apps/server 的开发/启动入口。存在的理由只有一个:环境变量不能写在 npm script 的
 * 命令行里 —— `VAR=x cmd` 那种前缀在 Windows 的 cmd 下直接报错,而且它还会顶掉
 * 上层 `npm run dev` 已经设好的值。放到脚本里用 `??` 兜底,两个问题一起消失。
 *
 * 用法:`node scripts/dev-server.mjs [--watch]`
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDevDataDir } from '../../../scripts/dev-utils.mjs';

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(serverRoot, '../..');
const watch = process.argv.includes('--watch');

const env = {
  ...process.env,
  VEYLIN_REPO_ROOT: process.env.VEYLIN_REPO_ROOT ?? repoRoot,
  VEYLIN_DATA_DIR: resolveDevDataDir(repoRoot),
};

const child = spawn(
  process.execPath,
  watch ? ['--import', 'tsx', '--watch', 'src/server.ts'] : ['--import', 'tsx', 'src/server.ts'],
  { cwd: serverRoot, env, stdio: 'inherit' },
);

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
