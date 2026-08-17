/**
 * 在访达/资源管理器里显示某个路径 —— 桌面端的 Show in Folder,由服务端代劳
 * (前端没有 opener/shell 插件绑定)。
 *
 * **边界是这里唯一要紧的事**:只允许显示**项目文件夹之内**的东西,否则这就是一个
 * "让本机打开任意路径"的接口。而且命令一律走参数数组、不拼字符串 —— 没有 shell
 * 解释,也就没有注入面。
 */
import { execFile } from 'node:child_process';
import { dirname, resolve, sep } from 'node:path';

export function isInsideFolder(folder: string | undefined | null, path: string): boolean {
  if (!folder) return false;                  // 没绑文件夹 ⇒ 什么都不给显示
  const root = resolve(folder);
  const target = resolve(path);
  // 前缀陷阱:`/a/bcd` 不在 `/a/b` 里 —— 必须比到分隔符
  return target === root || target.startsWith(root.endsWith(sep) ? root : root + sep);
}

export function revealCommand(
  platform: NodeJS.Platform | string,
  path: string,
): { cmd: string; args: string[] } | null {
  if (platform === 'darwin') return { cmd: 'open', args: ['-R', path] };
  if (platform === 'win32') return { cmd: 'explorer', args: [`/select,${path}`] };
  if (platform === 'linux') return { cmd: 'xdg-open', args: [dirname(path)] };
  return null;                                 // 认不出的平台不猜
}

export async function revealInFileManager(
  folder: string | undefined,
  path: string,
): Promise<{ ok: boolean; message?: string }> {
  if (!isInsideFolder(folder, path)) {
    return { ok: false, message: '只能显示项目文件夹里的东西' };
  }
  const c = revealCommand(process.platform, path);
  if (!c) return { ok: false, message: `这个平台不支持:${process.platform}` };
  return new Promise((res) => {
    execFile(c.cmd, c.args, (err) => {
      res(err ? { ok: false, message: err.message } : { ok: true });
    });
  });
}
