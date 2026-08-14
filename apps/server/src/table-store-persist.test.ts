/**
 * 导入完成 ⇒ 已经落盘。
 *
 * 落盘是 fire-and-forget 的链式写。实测撞到过:导 49,350 行进去,内存里是全的,
 * 库里只有 39,685 —— 进程在链走完之前退出了,**静默少一截**。对用户就是:导一张
 * 大表、紧接着关掉 app,数据悄悄不全,而且没有任何地方报错。
 *
 * 所以要有一个"等落盘"的口子,让"导完了"这句话为真。
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'veylin-persist-'));
process.env.VEYLIN_DATA_DIR = dataDir;

const { connectDb, closeDb, listTableRows: rowsFromDb } = await import('@veylin/db');
const { initTableStore, createTableSheet, importTableSheet, flushTablePersist, listTableRows } =
  await import('./table-store.js');
const { PERSONAL_SCOPE, sheetIdFor } = await import('./table-scope.js');

describe('导入的落盘', () => {
  before(async () => {
    await connectDb();
    await initTableStore();
  });
  after(async () => {
    await closeDb();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('flushTablePersist 之后,库里的行数与内存一致(不是"大致一致")', async () => {
    createTableSheet('bulk', PERSONAL_SCOPE);
    const id = sheetIdFor(PERSONAL_SCOPE, 'bulk');
    const rows = Array.from({ length: 2000 }, (_, i) => ({ a: `v${i}` }));

    importTableSheet(id, [], rows, undefined, [{ key: 'a', name: 'A', type: 'text' as const }]);
    assert.equal(listTableRows(id).length, 2000, '内存里是全的');

    await flushTablePersist();

    const persisted = await rowsFromDb(id);
    assert.equal(persisted.length, 2000, '落盘也必须是全的 —— 少一行都是静默丢数据');
  });

  it('没有待落盘的东西时,flush 立刻返回', async () => {
    await flushTablePersist();
    await flushTablePersist();
  });
});
