/**
 * 绑项目文件夹(spec 2026-08-14 §2)。
 *
 * 选目录只有桌面端做得到 —— 浏览器没有能拿到绝对路径的 API(`webkitdirectory`
 * 给的是相对路径,服务端据此写不了文件)。所以这里的重点不是"怎么选",是
 * **选不了的时候说什么**:不能让人点了没反应,更不能假装绑上了。
 */
import { isTauri } from '@/lib/tauri-web-view';
import { pickWithTimeout, type PickResult } from '@/lib/project-folder-pick';

export function folderPickAvailability(
  env: { isDesktop: boolean } = { isDesktop: isTauri() },
): { canPick: boolean; reason?: string } {
  if (env.isDesktop) return { canPick: true };
  return {
    canPick: false,
    reason: '浏览器里打不开系统选择框 —— 把文件夹路径粘到下面就行(访达里 ⌘⌥C 复制路径)。',
  };
}

/** 界面上那一行字:绑了显示路径,没绑要讲清楚**后果**而不只是"未设置"。 */
export function describeFolderState(folder: string | undefined | null): string {
  if (folder) return `项目文件夹:${folder}`;
  return '这个项目还没有文件夹 —— 导入的原件不会留档,只存解析出来的行。';
}

/**
 * 打开系统目录选择框(仅桌面端),**带超时**。
 *
 * 实测这个原生面板会挂住不返回,把整个应用卡死。所以它只是便利路径:超时/报错
 * 都如实回报,界面转而请用户把路径粘进来(见 project-folder-pick.ts)。
 */
export async function pickProjectFolder(timeoutMs = 15_000): Promise<PickResult> {
  if (!isTauri()) return { status: 'unavailable' };
  return pickWithTimeout(async () => {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const picked = await open({ directory: true, multiple: false, title: '选择项目文件夹' });
    return typeof picked === 'string' ? picked : null;
  }, timeoutMs);
}

/**
 * 在访达/资源管理器里显示某个路径(与 Claude 项目里的 Show in Folder 同形)。
 *
 * 由**服务端**代劳:前端没有 opener/shell 的插件绑定,而服务端本来就是本机进程。
 * 服务端只允许显示项目文件夹之内的东西(见 project-reveal.ts)。
 */
export async function revealPath(
  path: string,
  threadId?: string,
  projectId?: string,
): Promise<boolean> {
  try {
    const res = await fetch('/api/project/reveal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // projectId:项目页没有 threadId,只按 threadId 反查会解析成个人区、
      // 拿不到文件夹,于是"点了没反应"(实测)。
      body: JSON.stringify({ path, threadId, projectId }),
    });
    const data = (await res.json()) as { ok?: boolean };
    return res.ok && data.ok === true;
  } catch {
    return false;
  }
}
