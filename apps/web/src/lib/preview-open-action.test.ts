import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { newSheetName, previewOpenTarget } from './preview-open-action';

describe('previewOpenTarget', () => {
  it('**表格去表格面板** —— 预览只是概览,能筛选统计的是那张表', () => {
    for (const n of ['a.xlsx', 'b.XLSM', 'c.csv', 'd.xls']) {
      assert.equal(previewOpenTarget(n), 'table', n);
    }
  });

  it('文档去文档面板', () => {
    for (const n of ['a.docx', 'b.pdf', 'c.pptx', 'd.md']) {
      assert.equal(previewOpenTarget(n), 'doc', n);
    }
  });

  it('**认不出的类型就不给这个动作** —— 给一个点了没反应的按钮更糟', () => {
    assert.equal(previewOpenTarget('a.step'), null);
    assert.equal(previewOpenTarget('README'), null);
  });
});

describe('newSheetName', () => {
  it('用文件名(去后缀)', () => {
    assert.equal(newSheetName('taobao_开发组件_顾时瑞.xlsx', []), 'taobao_开发组件_顾时瑞');
  });

  it('**重名加序号,不覆盖已有的表** —— 覆盖等于把人已有的数据吃掉', () => {
    assert.equal(newSheetName('组件.xlsx', ['组件']), '组件 2');
    assert.equal(newSheetName('组件.xlsx', ['组件', '组件 2']), '组件 3');
  });

  it('带路径的名字只取最后一段;空名有兜底', () => {
    assert.equal(newSheetName('生成/报表.xlsx', []), '报表');
    assert.equal(newSheetName('.xlsx', []), '导入');
  });
});
