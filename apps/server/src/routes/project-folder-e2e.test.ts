/**
 * 端到端走一遍项目文件夹那条链(spec 2026-08-14 §8 的七条不变式)。
 *
 * 真起路由、真建文件夹、真写 xlsx —— 单测只证明每块零件对,这里证明**连起来对**:
 * 绑文件夹 → 导入(留档) → 再导同一份 → 改一个字节再导 → 快照 → 丢个新文件进
 * 文件夹 → 把文件夹移走。
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync, existsSync, statSync, readdirSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { closeDb, connectDb, insertThreadState } from '@veylin/db';
import { registerTablesRoutes } from './tables.js';
import { registerProjectsRoutes } from './projects.js';
import type { ServerDeps } from './types.js';
import { createProject } from '../project-store.js';
import { initTableStore, createTableSheet, importTableSheet } from '../table-store.js';
import { projectScope, sheetIdFor } from '../table-scope.js';
import { readManifest } from '../project-originals.js';

const TENANT = '88888888-8888-4888-8888-888888888888';
const THREAD = 'thread-folder-e2e';

function buildDeps(): ServerDeps {
  return {
    runtime: {} as ServerDeps['runtime'],
    queue: {} as ServerDeps['queue'],
    resolveContext: async () => ({ tenantId: TENANT, resourceOwnerId: 'user-1' }) as never,
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
    RAG_UPLOAD_MAX_BYTES: 32 * 1024 * 1024,
  };
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

describe('项目文件夹端到端', () => {
  let app: FastifyInstance;
  let folder: string;
  let projectId: string;
  let sheetId: string;

  before(async () => {
    await connectDb();
    await initTableStore();
    folder = mkdtempSync(join(tmpdir(), 'veylin-e2e-'));
    const project = await createProject(TENANT, { name: 'E2E 项目', sources: ['guolu'] });
    projectId = project.id;
    await insertThreadState({
      threadId: THREAD, tenantId: TENANT, resourceId: 'user-1',
      planMode: false, todos: [], activatedSkills: {}, pinnedSkills: [],
      project: projectId,
    } as never);
    app = Fastify({ bodyLimit: 32 * 1024 * 1024 });
    registerProjectsRoutes(app, buildDeps());
    registerTablesRoutes(app, buildDeps());
    await app.ready();
    // 项目作用域里先有一张表可导
    sheetId = sheetIdFor(projectScope(projectId), 'e2e');
    createTableSheet('e2e', projectScope(projectId));
    importTableSheet(sheetId, [], [{ a: '0' }], undefined, [{ key: 'a', name: 'A', type: 'text' }]);
  });

  after(async () => {
    await app.close();
    await closeDb();
    rmSync(folder, { recursive: true, force: true });
  });

  it('① 绑文件夹', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/api/projects/${projectId}`, payload: { folder },
    });
    assert.equal(res.statusCode, 200, res.body);
  });

  it('② 导入带原件字节 → 原件留档,并回报留档结果', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/table/import',
      payload: {
        sheet: sheetId, threadId: THREAD,
        column_names: ['a'], rows: [{ a: '1' }, { a: '2' }],
        file: { name: '计划.xlsx', base64: b64('v1-bytes') },
      },
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json() as { archived?: boolean; original?: { hash: string } };
    assert.equal(body.archived, true);
    assert.ok(body.original?.hash);
    assert.equal((await readManifest(folder)).originals.length, 1);
  });

  it('③ 同一份再导一次 → 仍然只有一份原件', async () => {
    await app.inject({
      method: 'POST', url: '/api/table/import',
      payload: {
        sheet: sheetId, threadId: THREAD, column_names: ['a'], rows: [{ a: '1' }],
        file: { name: '计划.xlsx', base64: b64('v1-bytes') },
      },
    });
    const m = await readManifest(folder);
    assert.equal(m.originals.length, 1);
    assert.equal(m.originals[0]!.seenCount, 2, '见过两次');
  });

  it('④ 改一个字节再导 → 两份并存,旧的还在', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/table/import',
      payload: {
        sheet: sheetId, threadId: THREAD, column_names: ['a'], rows: [{ a: '9' }],
        file: { name: '计划.xlsx', base64: b64('v2-bytes') },
      },
    });
    assert.equal(res.statusCode, 200);
    const m = await readManifest(folder);
    assert.equal(m.originals.length, 2);
  });

  it('⑤ 快照 → 文件落在 快照/ 下,而且是只读的', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/table/snapshot',
      payload: { sheet: sheetId, threadId: THREAD },
    });
    assert.equal(res.statusCode, 200, res.body);
    const { path } = res.json() as { path: string };
    assert.ok(existsSync(path), path);
    assert.ok(path.includes(join(folder, '快照')));
    assert.equal(statSync(path).mode & 0o222, 0, '快照必须只读 —— 它的意义就是不变');
  });

  it('⑥ 往文件夹里丢一个新文件 → 列为待导入,但没被吸收', async () => {
    writeFileSync(join(folder, '别人放的.xlsx'), 'dropped-in');
    const res = await app.inject({
      method: 'GET', url: `/api/table/inbox?threadId=${THREAD}`,
    });
    const body = res.json() as { pending: Array<{ name: string }> };
    assert.deepEqual(body.pending.map((f) => f.name), ['别人放的.xlsx']);
    // 没有被自动解析:原件仓里仍然只有导入过的那两份
    assert.equal((await readManifest(folder)).originals.length, 2);
  });

  it('⑦ 文件夹被移走 → 导入照做但明说没留档,不假装', async () => {
    const gone = `${folder}-moved`;
    rmSync(gone, { recursive: true, force: true });
    renameSync(folder, gone);
    try {
      const res = await app.inject({
        method: 'POST', url: '/api/table/import',
        payload: {
          sheet: sheetId, threadId: THREAD, column_names: ['a'], rows: [{ a: '3' }],
          file: { name: '计划.xlsx', base64: b64('v3') },
        },
      });
      assert.equal(res.statusCode, 200, '行照样导进去');
      const body = res.json() as { archived?: boolean; archiveNote?: string };
      assert.equal(body.archived, false);
      assert.match(body.archiveNote ?? '', /不存在/);

      // 快照同样:说清楚,而不是静默失败
      const snap = await app.inject({
        method: 'POST', url: '/api/table/snapshot',
        payload: { sheet: sheetId, threadId: THREAD },
      });
      assert.equal(snap.statusCode, 400);
      assert.match((snap.json() as { message: string }).message, /不存在/);
    } finally {
      renameSync(gone, folder);
      assert.ok(readdirSync(folder).length > 0);
    }
  });
});
