/**
 * 导入即留档 —— 把一次表格导入的**原件**存进项目文件夹,并给出 sheet 的来源指针。
 * spec: docs/specs/2026-08-14-project-folder-immutable-originals.md §3、§4
 *
 * 留不成不是错误,是**要说出来的事实**:没绑文件夹、没带原件字节、文件夹被移走 ——
 * 三种情形都照常导入行,但把原因原样报给调用方,由它转述给人。假装留了才是错。
 */
import type { TableSheetSource } from '@veylin/db';
import { folderExists, storeOriginal } from './project-originals.js';

export type ImportFilePayload = { name: string; base64: string };

export type ArchiveOutcome = {
  archived: boolean;
  source?: Extract<TableSheetSource, { kind: 'file' }>;
  /** 没留档时的原因(人话,直接可显示) */
  reason?: string;
};

export async function archiveImportedFile(input: {
  folder: string | undefined;
  projectId: string | null | undefined;
  file: ImportFilePayload | undefined;
  fromPath?: string;
}): Promise<ArchiveOutcome> {
  const { folder, projectId, file, fromPath } = input;

  if (!file?.base64) {
    return { archived: false, reason: '这次导入没有原件字节(agent 直接送的行),只存了解析结果' };
  }
  if (!folder) {
    return { archived: false, reason: '当前项目没有绑定文件夹,原件没有留档 —— 只存了解析结果' };
  }
  if (!(await folderExists(folder))) {
    // 文件夹被移走/删了要明说(spec §8.7):静默吞掉会让"留档"这个承诺变成假话。
    return { archived: false, reason: `项目文件夹不存在:${folder} —— 原件没有留档` };
  }

  const bytes = Buffer.from(file.base64, 'base64');
  const rec = await storeOriginal(folder, file.name, bytes, fromPath);
  return {
    archived: true,
    source: {
      kind: 'file',
      fileHash: rec.hash,
      fileName: rec.name,
      importedAt: rec.importedAt,
      ...(rec.fromPath ? { fromPath: rec.fromPath } : {}),
      ...(projectId ? { project: projectId } : {}),
    },
  };
}
