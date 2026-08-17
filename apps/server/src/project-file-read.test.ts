/**
 * 文件夹即上下文 = **知道这里有什么,要用时再读** —— 不是把文件塞进 context。
 * 与 table_query 是同一个道理,只是从「行」抬到「文件」。
 *
 * 这里钉的是**能力边界要诚实**:每类文件能做到什么、做不到什么,由代码说清楚,
 * 而不是让 agent 拿到半截内容当全部。
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { planFileRead, readProjectFile } from './project-file-read.js';

let folder: string;
beforeEach(() => { folder = mkdtempSync(join(tmpdir(), 'veylin-read-')); });
afterEach(() => { rmSync(folder, { recursive: true, force: true }); });

describe('planFileRead —— 先说清楚这类文件能怎么读', () => {
  it('纯文本类:直接读', () => {
    for (const n of ['a.md', 'b.txt', 'c.csv', 'd.json', 'e.log']) {
      assert.equal(planFileRead(n).kind, 'text', n);
    }
  });

  it('表格:给概览(页签/表头/前几行),真要分析得导进来用 table_query', () => {
    const p = planFileRead('计划.xlsx');
    assert.equal(p.kind, 'sheet');
    assert.match(p.note ?? '', /table_query/);
  });

  it('Word:抽文字', () => {
    assert.equal(planFileRead('说明.docx').kind, 'doc');
  });

  it('PDF 现在也读得了 —— 从前只能"拖进对话框",而同一份文件躺在项目里却读不了', () => {
    assert.equal(planFileRead('图纸.pdf').kind, 'doc');
  });

  it('读不了的类型**明说读不了**,并给出可行的替代', () => {
    // 老二进制格式是真读不了。"转成 PDF" 对一份 .doc 是没用的建议,
    // 能照做的那句是"用 Office 另存为 .docx"。
    const p = planFileRead('纪要.doc');
    assert.equal(p.kind, 'unsupported');
    assert.match(p.note ?? '', /另存为 \.docx/);
  });

  it('没见过的后缀也照实说,不硬当文本读', () => {
    assert.equal(planFileRead('模型.step').kind, 'unsupported');
  });
});

describe('readProjectFile', () => {
  it('文本按需截断,并**说明还有多少没给**', async () => {
    writeFileSync(join(folder, 'a.md'), Array.from({ length: 500 }, (_, i) => `第 ${i} 行`).join('\n'));
    const out = await readProjectFile(folder, 'a.md', { limit: 10 });
    assert.equal(out.kind, 'text');
    assert.equal(out.text!.split('\n').length, 10);
    assert.equal(out.totalLines, 500);
    assert.match(out.notice ?? '', /490/, '没给的部分要说出来');
  });

  it('offset 往后读', async () => {
    writeFileSync(join(folder, 'a.md'), ['一', '二', '三', '四'].join('\n'));
    const out = await readProjectFile(folder, 'a.md', { offset: 2, limit: 2 });
    assert.equal(out.text, '三\n四');
  });

  it('xlsx 给概览:页签、表头、行数、前几行', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([{ 订单号: 'T-1', 分厂: '金工' }, { 订单号: 'T-2', 分厂: '锻件' }]),
      '查询表格',
    );
    writeFileSync(join(folder, 'p.xlsx'), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));

    const out = await readProjectFile(folder, 'p.xlsx', { limit: 1 });
    assert.equal(out.kind, 'sheet');
    assert.deepEqual(out.sheets, ['查询表格']);
    assert.deepEqual(out.columns, ['订单号', '分厂']);
    assert.equal(out.totalRows, 2);
    assert.equal(out.rows!.length, 1);
    assert.match(out.notice ?? '', /table_query/, '别让 agent 拿概览当全量分析');
  });

  it('逃出项目文件夹的路径一律拒绝', async () => {
    const out = await readProjectFile(folder, '../../../etc/passwd');
    assert.equal(out.kind, 'refused');
    assert.match(out.notice ?? '', /项目文件夹/);
  });

  it('不存在的文件:说不存在,不是空内容', async () => {
    const out = await readProjectFile(folder, '没有这个.md');
    assert.equal(out.kind, 'missing');
  });

  it('子目录里的文件也能读(路径相对项目文件夹)', async () => {
    mkdirSync(join(folder, '分析'));
    writeFileSync(join(folder, '分析', 'x.md'), 'hello');
    const out = await readProjectFile(folder, '分析/x.md');
    assert.equal(out.text, 'hello');
  });
});
