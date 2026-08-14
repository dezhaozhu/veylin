/**
 * 项目文件夹里冒出来的新文件 —— spec §6:**只列,不自动吸收**。
 *
 * 顺手往文件夹里放一份 ≠ 它就是项目数据。自动解析会让"这东西什么时候进来的、
 * 谁放的"变成无人知晓,而"导入即留档"要的正是这两件事说得清。所以这里只回答
 * 一个问题:**有哪些文件我还没见过**,由人点头才走导入。
 *
 * 判重认**哈希**不认文件名:同一份内容换个名字不是新东西;同名而内容变了是新版本。
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { readManifest, sha256 } from './project-originals.js';

/** 认得的后缀。别的(.DS_Store、.txt 笔记…)不提示 —— 提示得多就没人看了。 */
const KNOWN = new Set(['.xlsx', '.xls', '.csv', '.docx', '.doc', '.pdf', '.pptx', '.md']);
/** 只看顶层;.veylin 是我们自己的仓,快照/ 是我们自己生成的产物。 */
const SKIP_DIRS = new Set(['.veylin', '快照']);

export type InboxFile = { name: string; bytes: number; hash: string };

export async function scanProjectInbox(
  folder: string,
): Promise<{ pending: InboxFile[]; note?: string }> {
  let entries;
  try {
    entries = await readdir(folder, { withFileTypes: true });
  } catch {
    return { pending: [], note: `项目文件夹不存在或读不到:${folder}` };
  }

  const known = new Set((await readManifest(folder)).originals.map((o) => o.hash));
  const pending: InboxFile[] = [];

  for (const e of entries) {
    if (e.isDirectory() || SKIP_DIRS.has(e.name)) continue;
    if (!KNOWN.has(extname(e.name).toLowerCase())) continue;
    const p = join(folder, e.name);
    try {
      const bytes = (await stat(p)).size;
      const hash = sha256(await readFile(p));
      if (known.has(hash)) continue;          // 见过的内容,换名字也不是新的
      pending.push({ name: e.name, bytes, hash });
    } catch {
      // 读不到的(权限、正在写)这一轮跳过,下次再说 —— 不因为一个文件毁掉整次扫描
    }
  }
  return { pending: pending.sort((a, b) => a.name.localeCompare(b.name)) };
}
