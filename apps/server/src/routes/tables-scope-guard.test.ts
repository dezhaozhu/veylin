/**
 * 拿着**别的作用域**的 sheet id 来写,必须 404 —— 不能悄悄改写别的表。
 *
 * 归属那一刀留下的真 bug:解析在找不到时会退回"本作用域的默认表",于是一个
 * 请求带着项目里的 sheet id、却没带 threadId(个人区),就把行写进了个人区的
 * `me~main`。**返回 200、写错地方**,比 404 糟得多。
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { closeDb, connectDb } from '@veylin/db';
import { registerTablesRoutes } from './tables.js';
import type { ServerDeps } from './types.js';
import { createTableSheet, importTableSheet, initTableStore, listTableRows } from '../table-store.js';
import { PERSONAL_SCOPE, projectScope, sheetIdFor } from '../table-scope.js';

const TENANT = '77777777-7777-4777-8777-777777777777';
const FOREIGN = projectScope('some-other-project');

function buildDeps(): ServerDeps {
  return {
    runtime: {} as ServerDeps['runtime'],
    queue: {} as ServerDeps['queue'],
    resolveContext: async () => ({ tenantId: TENANT, resourceOwnerId: 'u1' }) as never,
    isForbiddenError: () => false,
    rebuildMcp: async () => undefined,
    ensureMcpForTenant: async () => undefined,
    getMcpToolsets: () => ({}),
    getMcpGroups: () => ({}),
    getMcpToolIndex: () => [],
    getTaskToolset: () => ({}),
    readTaskSnapshot: async () => ({ tasks: [] }),
    subscribeTaskEvents: () => () => undefined,
    mcpHealthByTenant: new Map(),
    RAG_UPLOAD_MAX_BYTES: 1024 * 1024,
  };
}

describe('表格路由的作用域守卫', () => {
  let app: FastifyInstance;
  const foreignId = sheetIdFor(FOREIGN, 'schedule');
  const mainId = sheetIdFor(PERSONAL_SCOPE, 'main');

  before(async () => {
    await connectDb();
    await initTableStore();
    app = Fastify();
    registerTablesRoutes(app, buildDeps());
    await app.ready();
    createTableSheet('schedule', FOREIGN);
    importTableSheet(foreignId, [], [{ a: '别的项目的行' }], undefined,
                     [{ key: 'a', name: 'A', type: 'text' }]);
  });
  after(async () => { await app.close(); await closeDb(); });

  it('POST /rows 带别的作用域的 sheet id(没带 threadId=个人区)→ 404,不写进 me~main', async () => {
    const before = listTableRows(mainId).length;
    const res = await app.inject({
      method: 'POST', url: '/api/table/rows', payload: { sheet: foreignId },
    });
    assert.equal(res.statusCode, 404, res.body);
    assert.equal(listTableRows(mainId).length, before, '一行也不该落进个人区的主表');
  });

  it('POST /import 同理 —— 两万行不能因为少带一个参数就倒进别的表', async () => {
    const before = listTableRows(mainId).length;
    const res = await app.inject({
      method: 'POST',
      url: '/api/table/import',
      payload: { sheet: foreignId, column_names: ['a'], rows: [{ a: '1' }, { a: '2' }] },
    });
    assert.equal(res.statusCode, 404, res.body);
    assert.equal(listTableRows(mainId).length, before);
  });

  it('不给 sheet → 落到本作用域的默认表(这条保持不变)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/table' });
    assert.equal(res.statusCode, 200);
    assert.equal((res.json() as { sheet: string }).sheet, mainId);
  });
});
