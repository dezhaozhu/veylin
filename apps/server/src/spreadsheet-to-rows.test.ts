import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as XLSX from 'xlsx';

import { normalizeHeaders, parseSpreadsheet } from './spreadsheet-to-rows.js';

const book = (sheets: Record<string, unknown[][]>): Buffer => {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};

describe('parseSpreadsheet', () => {
  it('**整表都要**,不是前几行 —— 缺的正是这一点', () => {
    const rows = Array.from({ length: 120 }, (_, i) => [i + 1, `件${i + 1}`]);
    const out = parseSpreadsheet(book({ 明细: [['序号', '名称'], ...rows] }));
    assert.equal(out.rows.length, 120);
    assert.equal(out.rows[119]!.名称, '件120');
  });

  it('工作簿里有多个页签时,说清用了哪个、还有哪些没导', () => {
    const out = parseSpreadsheet(book({ 甲: [['a'], ['1']], 乙: [['b'], ['2']] }), '乙');
    assert.equal(out.sheet, '乙');
    assert.deepEqual(out.others, ['甲']);
    assert.deepEqual(out.rows, [{ b: '2' }]);
  });

  it('指定的页签不存在就退回第一个 —— 不报错,但 sheet 字段会说实话', () => {
    const out = parseSpreadsheet(book({ 甲: [['a'], ['1']] }), '不存在');
    assert.equal(out.sheet, '甲');
  });

  it('**空表不崩**,给空列空行', () => {
    const out = parseSpreadsheet(book({ 空: [] }));
    assert.deepEqual([out.columns, out.rows], [[], []]);
  });

  it('只有表头没有数据 —— 列在,行是空的', () => {
    const out = parseSpreadsheet(book({ 甲: [['序号', '名称']] }));
    assert.deepEqual(out.columns, ['序号', '名称']);
    assert.deepEqual(out.rows, []);
  });

  it('**短行补空,不越位** —— 缺格子的行不能把后面的值挤到前一列', () => {
    const out = parseSpreadsheet(book({ 甲: [['a', 'b', 'c'], ['1', '', '3'], ['4']] }));
    assert.deepEqual(out.rows, [
      { a: '1', b: '', c: '3' },
      { a: '4', b: '', c: '' },
    ]);
  });

  it('表头重名/空表头都要能当键用', () => {
    assert.deepEqual(normalizeHeaders(['日期', '日期', '', null]), ['日期', '日期_2', '列3', '列4']);
  });

  it('数字和日期都取成字符串 —— 表格面板的格子就是字符串', () => {
    const out = parseSpreadsheet(book({ 甲: [['n'], [42]] }));
    assert.equal(out.rows[0]!.n, '42');
  });
});
