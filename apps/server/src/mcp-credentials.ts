/**
 * 每个 MCP 服务器一份凭据。
 *
 * **不共用**:两家服务器共用一张 token,等于把其中一家的授权也给了另一家 ——
 * 而这种越权是静默的,两边都"能用",没有任何一处会报错。
 *
 * 和 Compass 那份凭据同样的规矩:数据目录、0600、**用的时候才读**(改了不用重启)。
 * 同样的诚实边界:这不是系统钥匙串,防的是"凭据躺在可分发的文件里",防不了同一
 * 用户身份下的其它进程。
 */
import fs from 'node:fs';
import path from 'node:path';

import { ensureDataDir } from '@veylin/db';

const FILE = 'mcp-credentials.json';

export type McpCredential = {
  issuer: string;
  clientId: string;
  accessToken: string;
  refreshToken?: string;
};

function filePath(dataDir?: string): string {
  return path.join(dataDir ?? ensureDataDir(), FILE);
}

function readAll(dataDir?: string): Record<string, McpCredential> {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath(dataDir), 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, McpCredential>) : {};
  } catch {
    return {};
  }
}

export function readMcpCredential(serverId: string, dataDir?: string): McpCredential | null {
  const one = readAll(dataDir)[serverId];
  if (!one || typeof one.accessToken !== 'string' || !one.accessToken) return null;
  return one;
}

export function writeMcpCredential(
  serverId: string,
  cred: McpCredential,
  dataDir?: string,
): void {
  const all = readAll(dataDir);
  all[serverId] = cred;
  const file = filePath(dataDir);
  fs.writeFileSync(file, JSON.stringify(all, null, 2), { mode: 0o600 });
  // 已存在的文件 mode 不会被 writeFileSync 改 —— 显式 chmod,否则第二次写之后
  // 权限可能还是旧的。
  fs.chmodSync(file, 0o600);
}

export function clearMcpCredential(serverId: string, dataDir?: string): void {
  const all = readAll(dataDir);
  if (!(serverId in all)) return;
  delete all[serverId];
  const file = filePath(dataDir);
  fs.writeFileSync(file, JSON.stringify(all, null, 2), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

/** 这个服务器有没有授权过 —— 界面据此决定显示「授权」还是「已授权」。 */
export function hasMcpCredential(serverId: string, dataDir?: string): boolean {
  return readMcpCredential(serverId, dataDir) !== null;
}
