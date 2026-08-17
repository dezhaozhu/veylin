/**
 * **不许把本地文件盖到一张"来自 Compass"的表上。**
 *
 * table_import_file 的规则是"同名就整表替换"。可作用域里有一张表是云端拉下来的
 * (工序,带 `source.server=compass` 的出处戳)—— 一旦被本地 xlsx 覆盖,那张表
 * 就变成:**戳子说它来自 Compass,内容其实是本地文件**。
 *
 * 这种谎比丢数据更难查:后面所有基于它的判断都建立在一个假出处上,而界面上
 * 什么异常都看不出来。宁可拒绝,让人换个名字。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as XLSX from 'xlsx';

import { buildTableTools } from './table-tools.js';
import {
  createTableSheet,
  importTableSheet,
  listTableRows,
  stampTableSheetSource,
} from './table-store.js';
import { PERSONAL_SCOPE } from './table-scope.js';

const folder = mkdtempSync(join(tmpdir(), 'import-guard-'));

function writeXlsx(name: string, aoa: unknown[][]): string {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'S');
  writeFileSync(join(folder, name), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  return name;
}

/** 工具在个人区跑(不用项目库),文件夹直接由这个假 ctx 供给。 */
const ctx = {
  requestContext: {
    get: (k: string) =>
      k === 'threadId' ? 'th-guard' : k === 'projectFolder' ? folder : undefined,
  },
} as never;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (input: object) => (buildTableTools().table_import_file.execute as any)(input, ctx);

describe('table_import_file 的护栏', () => {
  it('**盖不到云端来的表上** —— 戳子说 Compass、内容却是本地文件,是最难查的谎', async () => {
    const cloud = createTableSheet(`工序-${Date.now()}`, PERSONAL_SCOPE)!;
    importTableSheet(cloud.id, ['order_id'], [{ order_id: '云端原有' }]);
    // 无 DB 的纯内存套件里 persist 是尽力而为(同 table-selection-tool.test.ts 的容忍);
    // 内存里的 meta 已经打上戳,护栏要看的就是它。
    await stampTableSheetSource(cloud.id, {
      server: 'compass',
      loadedAt: new Date().toISOString(),
    }).catch(() => undefined);

    const file = writeXlsx('本地.xlsx', [['order_id'], ['本地新来']]);
    const out = await run({ path: file, sheet: cloud.name });

    assert.equal(out.ok, false, `居然让它覆盖了:${JSON.stringify(out).slice(0, 200)}`);
    assert.match(String(out.message), /Compass|云端|数据源/, `理由没说清:${out.message}`);
    assert.equal(listTableRows(cloud.id)[0]?.order_id, '云端原有', '云端表被改了');
  });

  it('普通的本地表,同名照旧整表替换 —— 护栏只挡有出处戳的那种', async () => {
    const local = createTableSheet(`本地表-${Date.now()}`, PERSONAL_SCOPE)!;
    importTableSheet(local.id, ['a'], [{ a: '旧' }]);

    const file = writeXlsx('新的.xlsx', [['a'], ['新']]);
    const out = await run({ path: file, sheet: local.name });

    assert.equal(out.ok, true, JSON.stringify(out).slice(0, 200));
    assert.equal(listTableRows(local.id)[0]?.a, '新');
  });

  it('**不是表格文件就直说**,不要把栈抛给模型', async () => {
    writeFileSync(join(folder, '坏的.xlsx'), Buffer.from('这不是 zip,更不是 xlsx'));
    const out = await run({ path: '坏的.xlsx' });
    assert.equal(out.ok, false);
    assert.match(String(out.message), /解析不了|不是表格|损坏/);
  });

  it('**只有表头没有数据的表**:导得进去,但要说清是 0 行', async () => {
    const file = writeXlsx('只有表头.xlsx', [['序号', '名称']]);
    const out = await run({ path: file, sheet: `空表-${Date.now()}` });
    assert.equal(out.ok, true, JSON.stringify(out).slice(0, 200));
    assert.equal(out.imported, 0);
  });

  it('文件不在就说文件不在,不报一个含糊的失败', async () => {
    const out = await run({ path: '没有这个.xlsx' });
    assert.equal(out.ok, false);
    assert.match(String(out.message), /读不到/);
  });
});
