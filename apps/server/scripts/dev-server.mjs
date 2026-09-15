#!/usr/bin/env node
/**
 * apps/server 的开发/启动入口。两件事:
 *
 * 1. 环境变量不能写在 npm script 的命令行里 —— `VAR=x cmd` 那种前缀在 Windows 的
 *    cmd 下直接报错,而且它还会顶掉上层 `npm run dev` 已经设好的值。这里用 `??` 兜底。
 *
 * 2. **cwd 必须是仓库根**。Windows 上 surrealkv 只接受相对 cwd 的路径(见
 *    packages/db/src/paths.ts 的 surrealKvUrl),所以 cwd 变了就是换了个库 ——
 *    日志照样打印同一个 VEYLIN_DATA_DIR,数据却写去别处。以前各入口 cwd 不同,
 *    结果一台机器上攒出好几份互不可见的 thread_state。
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

const entry = 'apps/server/src/server.ts';
const child = spawn(
  process.execPath,
  watch ? ['--import', 'tsx', '--watch', entry] : ['--import', 'tsx', entry],
  { cwd: repoRoot, env, stdio: 'inherit' },
);

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
