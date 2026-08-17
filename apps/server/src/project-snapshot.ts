/**
 * 导出与快照 —— spec: docs/specs/2026-08-14-project-folder-immutable-originals.md §5
 *
 * 连接器视图是**会腐烂的缓存**;要"当时那一份",走一个显式动作生成**不可变文件**,
 * 而不是让缓存偷偷变成事实。快照落进项目文件夹的 `快照/`,只读,文件名带生成时间,
 * 另附一页「来源」说清楚它是什么 —— 半年后打开它,还知道这是哪来的、多少行、几时生成。
 */
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import type { TableSheetSource } from '@veylin/db';
import { folderExists, safeName } from './project-originals.js';

const SNAPSHOT_DIR = '快照';

const two = (n: number) => String(n).padStart(2, '0');

/** `工序 快照 2026-08-14 15-20.xlsx` —— 按事件命名 + 生成时间,不用时间戳数字。 */
export function snapshotFileName(sheetName: string, at: Date): string {
  const stamp =
    `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ` +
    `${two(at.getHours())}-${two(at.getMinutes())}`;
  return `${safeName(sheetName)} 快照 ${stamp}.xlsx`;
}

function describeOrigin(origin: TableSheetSource | undefined): string {
  if (!origin) return '本地表(无来源记录)';
  if ((origin as { kind?: string }).kind === 'file') {
    const f = origin as Extract<TableSheetSource, { kind: 'file' }>;
    return `原件「${f.fileName}」(${f.importedAt} 导入)`;
  }
  const c = origin as Extract<TableSheetSource, { kind?: 'connector' }>;
  return `连接器 ${c.server}${c.tenant ? `(租户 ${c.tenant})` : ''}`;
}

export async function writeSheetSnapshot(input: {
  folder: string;
  sheetName: string;
  columns: Array<{ key: string; name: string }>;
  rows: Array<Record<string, unknown>>;
  origin?: TableSheetSource;
  at?: Date;
}): Promise<{ path: string; rows: number }> {
  const { folder, sheetName, columns, rows, origin } = input;
  const at = input.at ?? new Date();

  if (!(await folderExists(folder))) {
    // 静默失败会让"我已经导出了"变成假话。
    throw new Error(`项目文件夹不存在:${folder}`);
  }

  // 用显示名做表头,并且**丢掉 row_id** —— 那是我们的内部行号,给人的文件里不该有。
  const body = rows.map((r) =>
    Object.fromEntries(columns.map((c) => [c.name, r[c.key] ?? ''])),
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(body), safeName(sheetName).slice(0, 31));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([
      { 项: '来源', 值: describeOrigin(origin) },
      { 项: '行数', 值: String(rows.length) },
      { 项: '生成时间', 值: at.toISOString() },
      { 项: '说明', 值: '这是一份快照:生成之后不再变化。要最新数据请回连接器刷新。' },
    ]),
    '来源',
  );

  const dir = join(folder, SNAPSHOT_DIR);
  await mkdir(dir, { recursive: true });

  // 同一分钟再导一次不覆盖前一份:快照被悄悄改写就不再是快照了。
  const base = snapshotFileName(sheetName, at);
  let target = join(dir, base);
  let n = 2;
  // eslint-disable-next-line no-await-in-loop
  while (await exists(target)) {
    target = join(dir, base.replace(/\.xlsx$/, ` (${n++}).xlsx`));
  }

  await writeFile(target, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
  await chmod(target, 0o444);          // 从此不变
  return { path: target, rows: rows.length };
}

async function exists(p: string): Promise<boolean> {
  const { stat } = await import('node:fs/promises');
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
