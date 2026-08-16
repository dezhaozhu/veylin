/**
 * Compass 凭据的存放:文件 + **用的时候才读**。
 *
 * 起因是一次真实故障:token 过期,换了 `.env` 里的新值,401 照旧 —— `process.env`
 * 在进程启动那一刻就定死了,一个跑了 14 小时的 dev 进程手里还是旧的那张。人会
 * 以为自己签错了,再签一次,还是不通。所以这个模块的核心性质只有一条:
 * **存进去之后,不重启就能生效**。
 *
 * 为什么不是系统钥匙串(诚实边界):server 是 Tauri 的 sidecar 独立进程,钥匙串
 * 得由 Rust 端读出来再在 spawn 时传过去 —— 那又变回"启动时读一次",正是要消灭
 * 的东西。所以这里是数据目录下一个 0600 的文件:它防的是"凭据躺在仓库的 .env
 * 里",**防不了同一个用户身份下的其它进程**。这一句要留着,别让它被读成钥匙串。
 *
 * `.env` 仍然兜底:老部署和 dev 环境一行不用改。
 */
import fs from 'node:fs';
import path from 'node:path';

import { ensureDataDir } from '@veylin/db';

import type { CompassIdentityConfig } from './compass-identity.js';
import { parseCompassIdentityConfig } from './compass-identity.js';

const FILE = 'compass-identity.json';

export function credentialPath(dataDir?: string): string {
  return path.join(dataDir ?? ensureDataDir(), FILE);
}

export function readCompassCredential(dataDir?: string): CompassIdentityConfig | null {
  try {
    const raw = fs.readFileSync(credentialPath(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const { url, token } = parsed as Record<string, unknown>;
    // 半份凭据(只有 url 或只有 token)比完全没有更难查 —— 一律当没有。
    if (typeof url !== 'string' || !url.trim()) return null;
    if (typeof token !== 'string' || !token.trim()) return null;
    return { url: url.trim().replace(/\/+$/, ''), token: token.trim() };
  } catch {
    // 文件不存在、读不了、坏了 —— 都当作"没配",不让它把应用带下去。
    return null;
  }
}

export function writeCompassCredential(
  config: CompassIdentityConfig,
  dataDir?: string,
): void {
  const file = credentialPath(dataDir);
  // mode 传给 open 只在**新建**时生效;已存在的文件要显式 chmod,否则换一张
  // token 之后权限可能还是旧的。
  fs.writeFileSync(file, JSON.stringify(config, null, 2), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

export function clearCompassCredential(dataDir?: string): void {
  try {
    fs.unlinkSync(credentialPath(dataDir));
  } catch {
    // 本来就没有 = 已经是想要的状态。
  }
}

/**
 * 当前该用哪份身份:**文件优先,`.env` 兜底**。
 *
 * 每次调用都重新读 —— 这正是"不重启就生效"的实现方式。别在上层把结果缓存成
 * 模块级常量,那会把这个模块的意义抵消掉。
 */
export function resolveCompassIdentity(
  dataDir?: string,
  env: NodeJS.ProcessEnv = process.env,
): CompassIdentityConfig | null {
  return (
    readCompassCredential(dataDir) ??
    parseCompassIdentityConfig(env.VEYLIN_COMPASS_IDENTITY?.trim() ?? '')
  );
}

/**
 * 遮住 token,但留头尾。
 *
 * 全遮的话,人无法确认"界面上这张"是不是"我刚贴的那张" —— 而这恰恰是配错凭据
 * 时最需要回答的问题。太短的一律全遮:留头尾等于没遮。
 */
export function maskToken(token: string): string {
  if (token.length < 16) return '•'.repeat(8);
  return `${token.slice(0, 6)}…${token.slice(-3)}`;
}
