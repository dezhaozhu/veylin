/**
 * store 层的归属(spec §3.2、§3.3、§3.5、§5 的 1/2/3 条)。
 *
 * 钉的是那两个真事故:
 *   ① guolu 装一次直接**覆盖**上重那张 schedule(id 是全局常量)
 *   ② 个人区看得见项目的表(取数只查 thread_id,不看项目)
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTableSheet,
  importTableSheet,
  listTableRows,
  listTableSheets,
  resolveTableSheetId,
  sheetBelongsToScope,
  resetTableStore,
  DEFAULT_TABLE_SHEET,
} from './table-store.js';
import { PERSONAL_SCOPE, projectScope, sheetIdFor } from './table-scope.js';

const GUOLU = projectScope('guolu');
const SZ = projectScope('shangzhong');
const oneRow = (v: string) => [{ order_id: v }];
const cols = [{ key: 'order_id', name: '订单号', type: 'text' as const }];

async function seedSchedule(scope: ReturnType<typeof projectScope>, value: string) {
  const id = sheetIdFor(scope, 'schedule');
  createTableSheet('schedule', scope);
  importTableSheet(id, [], oneRow(value), undefined, cols);
  return id;
}

describe('两个项目的同名表', () => {
  beforeEach(async () => { await resetTableStore(); });

  it('并存,互不覆盖 —— 这就是 guolu 不再盖掉上重的那一条', async () => {
    await seedSchedule(GUOLU, 'G-1');
    await seedSchedule(SZ, 'S-1');

    assert.deepEqual(listTableRows(sheetIdFor(GUOLU, 'schedule')).map((r) => r['order_id']), ['G-1']);
    assert.deepEqual(listTableRows(sheetIdFor(SZ, 'schedule')).map((r) => r['order_id']), ['S-1']);
  });

  it('同一句 table_get(sheet:"schedule") 在两个项目拿到不同的表', async () => {
    await seedSchedule(GUOLU, 'G-1');
    await seedSchedule(SZ, 'S-1');

    assert.equal(resolveTableSheetId('schedule', GUOLU), sheetIdFor(GUOLU, 'schedule'));
    assert.equal(resolveTableSheetId('schedule', SZ), sheetIdFor(SZ, 'schedule'));
  });
});

describe('看不见对方', () => {
  beforeEach(async () => { await resetTableStore(); });

  it('个人区列不到项目的表;项目里列不到别的项目的', async () => {
    await seedSchedule(GUOLU, 'G-1');
    await seedSchedule(SZ, 'S-1');

    const personal = listTableSheets(PERSONAL_SCOPE).map((s) => s.id);
    assert.ok(!personal.some((id) => id.includes('schedule')), '个人区不该看到任何项目的表');

    const guolu = listTableSheets(GUOLU).map((s) => s.id);
    assert.deepEqual(guolu, [sheetIdFor(GUOLU, 'schedule')]);
  });

  it('项目里也列不到个人的表 —— 两个方向都不串', async () => {
    createTableSheet('我的清单', PERSONAL_SCOPE);
    assert.equal(listTableSheets(GUOLU).length, 0);
    assert.ok(listTableSheets(PERSONAL_SCOPE).some((s) => s.name === '我的清单'));
  });

  it('归属判定是显式的', async () => {
    const id = await seedSchedule(GUOLU, 'G-1');
    assert.ok(sheetBelongsToScope(id, GUOLU));
    assert.ok(!sheetBelongsToScope(id, SZ));
    assert.ok(!sheetBelongsToScope(id, PERSONAL_SCOPE));
  });

  it('拿着别的作用域的裸 id 解析,不给它 —— 落回本作用域', async () => {
    const foreign = await seedSchedule(GUOLU, 'G-1');
    const resolved = resolveTableSheetId(foreign, SZ);
    assert.notEqual(resolved, foreign, '跨作用域的 id 不该被原样接受');
  });
});

describe('默认表', () => {
  beforeEach(async () => { await resetTableStore(); });

  it('main 归个人区', () => {
    assert.equal(resolveTableSheetId(undefined, PERSONAL_SCOPE),
                 sheetIdFor(PERSONAL_SCOPE, DEFAULT_TABLE_SHEET));
    assert.ok(listTableSheets(PERSONAL_SCOPE).length >= 1);
  });

  it('刚进一个新项目是空的 —— 项目里不该凭空有一张我个人的空表', () => {
    assert.equal(listTableSheets(GUOLU).length, 0);
  });
});

describe('重名', () => {
  beforeEach(async () => { await resetTableStore(); });

  it('同作用域内重名建不出来;跨作用域同名没问题', () => {
    assert.ok(createTableSheet('清单', PERSONAL_SCOPE));
    assert.equal(createTableSheet('清单', PERSONAL_SCOPE), null, '同作用域重名');
    assert.ok(createTableSheet('清单', GUOLU), '别的作用域同名是两张表');
  });
});
