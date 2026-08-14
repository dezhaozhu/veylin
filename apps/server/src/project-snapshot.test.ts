/**
 * 导出与快照(spec 2026-08-14 §5)。
 *
 * 连接器视图是**会腐烂的缓存**。要"当时那一份",唯一正解是走一个显式动作,
 * 生成一个**不可变文件** —— 而不是让缓存偷偷变成事实。
 *
 * 快照落在项目文件夹的 `快照/` 下,文件名带生成时间;内容旁边记来源与行数,
 * 这样半年后打开它还知道它是什么。
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { writeSheetSnapshot, snapshotFileName } from './project-snapshot.js';

let folder: string;
beforeEach(() => { folder = mkdtempSync(join(tmpdir(), 'veylin-snap-')); });
afterEach(() => { rmSync(folder, { recursive: true, force: true }); });

const columns = [
  { key: 'order_id', name: '订单号' },
  { key: 'due_at', name: '交期' },
];
const rows = [
  { row_id: 'r1', order_id: 'T-1', due_at: '2026-03-06' },
  { row_id: 'r2', order_id: 'T-2', due_at: '2026-07-13' },
];

describe('snapshotFileName', () => {
  it('按事件命名 + 生成时间,不用时间戳数字', () => {
    const name = snapshotFileName('工序', new Date('2026-08-14T15:20:00'));
    assert.match(name, /^工序 快照 2026-08-14 15-20\.xlsx$/);
  });

  it('文件名里的路径分隔符被清掉', () => {
    assert.ok(!snapshotFileName('a/b', new Date('2026-08-14T00:00:00')).includes('/'));
  });
});

describe('writeSheetSnapshot', () => {
  it('写进 快照/ 目录,逐行等于当时的 sheet 内容', async () => {
    const out = await writeSheetSnapshot({
      folder, sheetName: '工序', columns, rows,
      origin: { kind: 'connector', server: 'compass', tenant: 'shangzhong', loadedAt: '2026-08-14T07:00:00Z' },
      at: new Date('2026-08-14T15:20:00'),
    });
    assert.ok(existsSync(out.path), out.path);
    assert.ok(out.path.includes(join(folder, '快照')));

    const wb = XLSX.read(readFileSync(out.path));
    const data = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets[wb.SheetNames[0]!]!);
    assert.equal(data.length, 2);
    assert.deepEqual(data[0], { 订单号: 'T-1', 交期: '2026-03-06' });
    assert.equal(Object.keys(data[0]!).includes('row_id'), false, '内部行号不该出现在给人的文件里');
  });

  it('另有一页说清楚它是什么:来源、行数、生成时间', async () => {
    const out = await writeSheetSnapshot({
      folder, sheetName: '工序', columns, rows,
      origin: { kind: 'connector', server: 'compass', tenant: 'shangzhong', loadedAt: '2026-08-14T07:00:00Z' },
      at: new Date('2026-08-14T15:20:00'),
    });
    const wb = XLSX.read(readFileSync(out.path));
    assert.ok(wb.SheetNames.includes('来源'), wb.SheetNames.join(','));
    const meta = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets['来源']!);
    const flat = Object.fromEntries(meta.map((r) => [r['项'], r['值']]));
    assert.equal(flat['行数'], '2');
    assert.equal(flat['来源'], '连接器 compass(租户 shangzhong)');
    assert.match(String(flat['生成时间']), /2026-08-14/);
  });

  it('快照是只读的 —— 它的意义就是从此不变', async () => {
    const out = await writeSheetSnapshot({
      folder, sheetName: '工序', columns, rows, at: new Date('2026-08-14T15:20:00'),
    });
    const { statSync } = await import('node:fs');
    assert.equal(statSync(out.path).mode & 0o222, 0);
  });

  it('同一分钟再导一次不覆盖前一份 —— 快照不该被悄悄改写', async () => {
    const at = new Date('2026-08-14T15:20:00');
    const a = await writeSheetSnapshot({ folder, sheetName: '工序', columns, rows, at });
    const b = await writeSheetSnapshot({ folder, sheetName: '工序', columns, rows, at });
    assert.notEqual(a.path, b.path);
    assert.ok(existsSync(a.path) && existsSync(b.path));
  });

  it('文件夹不在 → 说清楚,不静默失败', async () => {
    rmSync(folder, { recursive: true, force: true });
    await assert.rejects(
      writeSheetSnapshot({ folder, sheetName: '工序', columns, rows, at: new Date() }),
      /项目文件夹不存在/,
    );
  });
});
