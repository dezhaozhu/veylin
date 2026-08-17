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
  renderPdfPage,
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

/**
 * 读到的东西,或者两种"没读成":越界、不存在。
 *
 * 这两种和"读了但没内容"必须分开 —— 前者是我们拒绝/找不到,后者是文件本身。
 */
export type ReadResult = Omit<Extracted, 'kind'> & {
  kind: Extracted['kind'] | 'refused' | 'missing';
};

/**
 * 只许读项目文件夹之内 —— 与 Show in Folder 同一条边界。越界返回 null。
 * 抽出来是因为**渲染接口和读接口必须共用它**:一个能画文件夹外文件的渲染接口,
 * 就是一个读任意文件的接口。
 */
function insideFolder(folder: string, name: string): string | null {
  const root = resolve(folder);
  const target = resolve(folder, name);
  const rel = relative(root, target);
  if (rel.startsWith('..') || resolve(root, rel) !== target) return null;
  return target;
}

/** 右侧文档面板按页取图。画不出来回 null —— 空图会被当成"这一页是白的"。 */
export async function renderProjectFilePage(
  folder: string,
  name: string,
  page: number,
): Promise<string | null> {
  const target = insideFolder(folder, name);
  if (!target) return null;
  try {
    return await renderPdfPage(await readFile(target), page);
  } catch {
    return null;
  }
}

/**
 * 原始字节(带同一道"只能在项目文件夹里"的守卫)。
 * 给 table_import_file 用 —— 那条路要自己解析整张表,拿概览不够。
 */
export async function readProjectFileBytes(
  folder: string,
  name: string,
): Promise<Buffer | null> {
  const target = insideFolder(folder, name);
  if (!target) return null;
  try {
    return await readFile(target);
  } catch {
    return null;
  }
}

export async function readProjectFile(
  folder: string,
  name: string,
  opts: { offset?: number; limit?: number } = {},
): Promise<ReadResult> {
  const target = insideFolder(folder, name);
  if (!target) {
    return { kind: 'refused', notice: '只能读项目文件夹里的文件' };
  }
  try {
    await stat(target);
  } catch {
    return { kind: 'missing', notice: `文件不在:${name}` };
  }
  return extractDocument(name, await readFile(target), opts);
}
