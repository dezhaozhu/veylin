/**
 * 按需读项目文件夹里的文件。
 *
 * **文件夹即上下文 ≠ 把文件塞进 context**:上下文里只有"这里有哪些文件",内容
 * 要用时再取 —— 与 `table_query` 是同一个道理,只是从「行」抬到「文件」。
 *
 * 这里最要紧的是**能力边界诚实**:每类文件能做到什么由代码说清楚,不能让 agent
 * 拿到半截内容当全部。表格只给概览(页签/表头/前几行)并明说"要分析请导进来用
 * table_query";读不了的类型直接说读不了,并给一条可行的替代。
 */
import { readFile, stat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

import {
  extractDocument,
  planExtract,
  type ExtractPlan,
  type Extracted,
} from './document-extract.js';

/**
 * 能不能读、读出来是什么形状,由 `document-extract` 一处说了算 —— 这里只管
 * "只许读项目文件夹之内"这条边界。
 *
 * 从前这两件事分两处写,结果是同一份 xlsx 走文件夹能读、拖进对话框回一句
 * "转成 PDF 再来"。能力边界该跟着文件走,不跟着它从哪儿进来走。
 */
export type ReadPlan = ExtractPlan;
export const planFileRead = planExtract;

export type ReadResult = Extracted & { kind: Extracted['kind'] | 'refused' | 'missing' };

export async function readProjectFile(
  folder: string,
  name: string,
  opts: { offset?: number; limit?: number } = {},
): Promise<ReadResult> {
  const root = resolve(folder);
  const target = resolve(folder, name);
  // 只许读项目文件夹之内 —— 与 Show in Folder 同一条边界
  const rel = relative(root, target);
  if (rel.startsWith('..') || resolve(root, rel) !== target) {
    return { kind: 'refused', notice: '只能读项目文件夹里的文件' };
  }
  try {
    await stat(target);
  } catch {
    return { kind: 'missing', notice: `文件不在:${name}` };
  }
  return extractDocument(name, await readFile(target), opts);
}
