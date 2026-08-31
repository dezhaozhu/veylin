#!/usr/bin/env node
/**
 * 构建后自检:可选依赖的"在场状态"和产物必须自洽。判定逻辑(和它的单测)在
 * `src/lib/dist-invariants.ts` —— 这里只负责读盘和退出码。
 *
 * 接在 `npm run build` 后面,所以它跟着构建走:**在包真的装了的机器上**
 * (部署机 45、开发机)才有判别力。CI 没有 dhtmlx 私有源凭据,包永远不在场,
 * 那里它验的是"降级路径自洽",不是死代码。完整来龙去脉见 dist-invariants.ts。
 */
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDistInvariants, DHX_SPECIFIER } from '../src/lib/dist-invariants.ts';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.argv[2] ?? 'dist';
const assetsDir = join(webRoot, outDir, 'assets');

// 和 vite.config.ts 的 hasDhx 同一句解析 —— 两边必须问同一个问题,
// 否则这道检查会拿另一个前提去判卷。
const hasDhx = (() => {
  try {
    createRequire(join(webRoot, 'vite.config.ts')).resolve(DHX_SPECIFIER);
    return true;
  } catch {
    return false;
  }
})();

let chunks;
try {
  chunks = readdirSync(assetsDir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => ({ name: f, code: readFileSync(join(assetsDir, f), 'utf8') }));
} catch (err) {
  console.error(`[verify-dist] 读不到产物目录 ${assetsDir}:${err.message}`);
  process.exit(1);
}

if (chunks.length === 0) {
  console.error(`[verify-dist] ${assetsDir} 里没有 .js —— 构建产物是空的?`);
  process.exit(1);
}

const verdict = checkDistInvariants({ hasDhx, chunks });
if (!verdict.ok) {
  console.error(`[verify-dist] 产物自检未通过:${verdict.reason}`);
  process.exit(1);
}
console.log(
  `[verify-dist] ok — ${chunks.length} 个 chunk;@dhx/react-gantt ${hasDhx ? '在场且已打入' : '不在场(降级路径自洽)'}`,
);
