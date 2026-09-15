import { mkdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

/** Resolve the app-data directory for embedded SurrealDB / LibSQL files. */
export function resolveDataDir(): string {
  const fromEnv = process.env.VEYLIN_DATA_DIR?.trim();
  if (fromEnv) {
    if (isAbsolute(fromEnv)) return fromEnv;
    const anchor = process.env.VEYLIN_REPO_ROOT?.trim();
    if (anchor) return resolve(anchor, fromEnv);
    return resolve(fromEnv);
  }
  // 测试:**每个进程一个库**。不这么做的话所有 DB 测试都落到 ~/.veylin ——
  // 既往用户的真实数据目录里堆测试夹具(实测堆了 182 张表),又让并发跑的测试
  // 文件抢同一个嵌入式库的事务(那批"单独跑过、一起跑挂"就是这么来的)。
  // node --test 每个文件一个进程,所以按 pid 分目录正好一文件一库。
  if (process.env.VEYLIN_TEST_DATA === '1') {
    return join(tmpdir(), `veylin-test-${process.pid}`);
  }
  return join(homedir(), '.veylin');
}

export function ensureDataDir(): string {
  const dir = resolveDataDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

function toUrlPath(...segments: string[]): string {
  return join(...segments).replace(/\\/g, '/');
}

/**
 * SurrealKV URL for the embedded store.
 * On Windows, `surrealkv://D:/...` is parsed as host `D` and creates a relative
 * `./D/...` folder under cwd. Prefer a cwd-relative path when possible.
 *
 * **注意:Windows 上返回值是相对 cwd 的,于是 cwd 就成了库的一部分。**
 * 所有打开这个库的进程必须用同一个 cwd,否则同样的 VEYLIN_DATA_DIR、同样的
 * 「SurrealDB ready at ...」日志,数据会写进好几个互不可见的库 —— 实际踩过:
 * web dev 与 desktop dev 在 apps/server,打包后的 sidecar 在 dist/sidecar,
 * 于是一台机器上攒出三份 thread_state,表现是侧栏对话时有时无。
 *
 * 绝对路径这条路走不通(都实测过):两斜杠会按上面说的在 cwd 下造 `./D/...`;
 * 三斜杠 `surrealkv:///D:/...` 直接报 invalid filename (os error 123)。
 * 所以目前只能靠调用方保证 cwd 一致 —— dev 入口统一成仓库根,见
 * apps/server/scripts/dev-server.mjs。数据目录跨盘时 relative() 会退化成绝对
 * 路径,又掉回上面那个坑,这一块还没解决。
 */
export function surrealKvUrl(dataDir?: string): string {
  const dir = dataDir ?? ensureDataDir();
  const store = join(dir, 'veylin');
  const abs = toUrlPath(store);
  if (/^[A-Za-z]:\//.test(abs)) {
    const rel = toUrlPath(relative(process.cwd(), store));
    if (rel && rel !== '.' && !/^[A-Za-z]:\//.test(rel)) {
      return `surrealkv://${rel}`;
    }
  }
  return `surrealkv://${abs}`;
}

export function mastraLibsqlUrl(dataDir?: string): string {
  const dir = dataDir ?? ensureDataDir();
  return `file:${toUrlPath(dir, 'mastra-memory.db')}`;
}
