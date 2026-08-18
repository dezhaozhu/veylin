import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { csvCell, exportFileName, toCsv } from './table-export.js';

const BOM = '\ufeff';

describe('toCsv', () => {
  it('**带逗号/引号/换行的格子要加引号**,否则列会错位', () => {
    assert.equal(csvCell('a,b'), '"a,b"');
    assert.equal(csvCell('\u8bf4"\u662f"'), '"\u8bf4""\u662f"""');
    assert.equal(csvCell('\u7b2c\u4e00\u884c\n\u7b2c\u4e8c\u884c'), '"\u7b2c\u4e00\u884c\n\u7b2c\u4e8c\u884c"');
    assert.equal(csvCell('\u666e\u901a'), '\u666e\u901a');
  });

  it('空值给空串,不给 "null"/"undefined"', () => {
    assert.equal(csvCell(null), '');
    assert.equal(csvCell(undefined), '');
  });

  it('**开头带 BOM** —— 不加的话 Excel 打开中文就是乱码,等于没导', () => {
    assert.ok(toCsv(['\u540d\u79f0'], [{ '\u540d\u79f0': '\u7701\u7164\u5668' }]).startsWith(BOM));
  });

  it('按给定列序输出,缺的格子留空', () => {
    const csv = toCsv(['a', 'b'], [{ a: '1' }, { b: '2' }]);
    assert.equal(csv.replace(BOM, ''), 'a,b\r\n1,\r\n,2\r\n');
  });
});

describe('exportFileName', () => {
  it('\u53bb\u6389\u8def\u5f84\u5206\u9694\u7b26,\u4fdd\u7559\u4e2d\u6587', () => {
    assert.equal(exportFileName('\u5de5\u5e8f/\u660e\u7ec6'), '\u5de5\u5e8f_\u660e\u7ec6.csv');
  });

  it('\u7a7a\u540d\u6709\u515c\u5e95', () => {
    assert.equal(exportFileName('   '), '\u8868\u683c.csv');
  });
});
