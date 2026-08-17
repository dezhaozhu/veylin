/**
 * Project CRUD routes — HTTP-level tests via Fastify inject against the real
 * embedded SurrealDB (route registration style of compass-identity-refresh.test.ts,
 * DB conventions of ../project-store.test.ts).
 *
 * Dedicated tenant (`5555…`) so DEV_TENANT project rows created by other
 * suites in the same run can never blur list contents or the granted-source
 * set; a second tenant (`6666…`) plays the foreign owner for the not-found
 * posture cases.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { closeDb, connectDb } from '@veylin/db';
import { createProject, disableProject, getProject } from '../project-store.js';
import { registerProjectsRoutes } from './projects.js';
import type { ServerDeps } from './types.js';

const TENANT = '55555555-5555-4555-8555-555555555555';
const FOREIGN_TENANT = '66666666-6666-4666-8666-666666666666';

function buildDeps(): ServerDeps {
  return {
    runtime: {} as ServerDeps['runtime'],
    queue: {} as ServerDeps['queue'],
    resolveContext: async () => ({ tenantId: TENANT, userId: 'user-1' }) as never,
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
    RAG_UPLOAD_MAX_BYTES: 1024,
  };
}

describe('project CRUD routes', () => {
  let app: FastifyInstance;
  /** Enabled managed defaults — granted = ['guolu', 'shangzhong']. */
  let guoluDefaultId: string;
  /** Disabled managed default — 'duanjian' is NOT granted and NOT listed. */
  let disabledDefaultId: string;

  before(async () => {
    await connectDb();
    app = Fastify();
    registerProjectsRoutes(app, buildDeps());

    const guolu = await createProject(TENANT, {
      name: '锅炉厂',
      sources: ['guolu'],
      managed: true,
    });
    guoluDefaultId = guolu.id;
    await createProject(TENANT, { name: '上重', sources: ['shangzhong'], managed: true });
    const revoked = await createProject(TENANT, {
      name: '锻件分厂',
      sources: ['duanjian'],
      managed: true,
    });
    disabledDefaultId = revoked.id;
    await disableProject(TENANT, disabledDefaultId);
  });

  after(async () => {
    await app.close();
    await closeDb();
  });

  it('GET lists enabled projects only, as {id, name, sources, managed} exactly', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    assert.equal(res.statusCode, 200);
    const { projects } = res.json() as { projects: Record<string, unknown>[] };
    const names = projects.map((p) => p.name).sort();
    assert.deepEqual(names, ['上重', '锅炉厂']);
    assert.ok(!projects.some((p) => p.id === disabledDefaultId), 'disabled default must be hidden');
    for (const p of projects) {
      // No migratedFrom / enabled / tenantId leak — the wire shape is exactly
      // the four documented fields.
      assert.deepEqual(Object.keys(p).sort(), ['id', 'managed', 'name', 'sources']);
      assert.equal(p.managed, true);
    }
  });

  it('POST composes a user project: trims name, dedupes+sorts sources, managed:false', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: '  对比看板  ', sources: ['shangzhong', 'guolu', 'guolu'] },
    });
    assert.equal(res.statusCode, 200);
    const { ok, project } = res.json() as {
      ok: boolean;
      project: { id: string; name: string; sources: string[]; managed: boolean };
    };
    assert.equal(ok, true);
    assert.equal(project.name, '对比看板');
    assert.deepEqual(project.sources, ['guolu', 'shangzhong']);
    assert.equal(project.managed, false);

    const list = await app.inject({ method: 'GET', url: '/api/projects' });
    const listed = (list.json() as { projects: { id: string }[] }).projects;
    assert.ok(listed.some((p) => p.id === project.id), 'composed project must appear in the list');
  });

  it('POST rejects a blank name with 400', async () => {
    for (const payload of [{ sources: ['guolu'] }, { name: '   ', sources: ['guolu'] }]) {
      const res = await app.inject({ method: 'POST', url: '/api/projects', payload });
      assert.equal(res.statusCode, 400);
      assert.equal((res.json() as { ok: boolean }).ok, false);
    }
  });

  it('**零数据源的项目是合法的** —— 只用自己的文件,以后随时能加', async () => {
    // 原来强制至少选一个,等于把"项目"降成"数据源的别名" —— 而每个数据源本来就
    // 已经有一个默认项目;人自己建项目是为了"我要做的事"。而且建的那一刻常常还
    // 不知道要用哪个数据源。
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: '只放我自己的文件', sources: [] },
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json() as { ok: boolean; project: { sources: string[] } };
    assert.equal(body.ok, true);
    assert.deepEqual(body.project.sources, []);
  });

  it('但没授权的数据源仍然拒 —— 空集放开的是"必填",不是"随便填"', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'x', sources: ['nope'] },
    });
    assert.equal(res.statusCode, 400);
    assert.match((res.json() as { error: string }).error, /nope/);
  });

  it('POST rejects an ungranted source with 400 naming it (disabled default ⇒ not granted)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: '越权项目', sources: ['guolu', 'duanjian'] },
    });
    assert.equal(res.statusCode, 400);
    const body = res.json() as { ok: boolean; error: string };
    assert.equal(body.ok, false);
    assert.match(body.error, /duanjian/);
  });

  it('POST rejects a malformed sources value with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: '坏输入', sources: ['guolu', 7] },
    });
    assert.equal(res.statusCode, 400);
  });

  it('PATCH renames a user project (and ignores immutable fields in the body)', async () => {
    const created = await createProject(TENANT, { name: '改前', sources: ['guolu', 'shangzhong'] });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${created.id}`,
      // managed/enabled/migratedFrom in the body must be structurally inert.
      payload: {
        name: ' 改后 ',
        // **加宽是允许的,摘掉不是** —— 见下一条。这里原样提交,只改名字。
        sources: ['guolu', 'shangzhong'],
        managed: true,
        enabled: false,
        migratedFrom: 'compass-对比',
      },
    });
    assert.equal(res.statusCode, 200);
    const { project } = res.json() as {
      project: { name: string; sources: string[]; managed: boolean };
    };
    assert.equal(project.name, '改后');
    assert.deepEqual(project.sources, ['guolu', 'shangzhong']);
    assert.equal(project.managed, false);

    const stored = await getProject(TENANT, created.id);
    assert.ok(stored);
    assert.equal(stored.managed, false);
    assert.equal(stored.enabled, true);
    assert.equal(stored.migratedFrom, undefined);
  });

  it('**PATCH 摘掉数据源 → 400**:项目里已有的对话是照旧数据源得出的结论,换掉就对不上了', async () => {
    const created = await createProject(TENANT, { name: 'p', sources: ['guolu', 'shangzhong'] });
    const res = await app.inject({
      method: 'PATCH', url: `/api/projects/${created.id}`, payload: { sources: ['guolu'] },
    });
    assert.equal(res.statusCode, 400);
    assert.match((res.json() as { error: string }).error, /只能加|新建/);
    // 而且**不能落一半** —— 拒了就一个字节都不动。
    assert.deepEqual((await getProject(TENANT, created.id))?.sources, ['guolu', 'shangzhong']);
  });

  it('PATCH 再挂一个数据源 → 允许(加宽不会让老结论失真)', async () => {
    const created = await createProject(TENANT, { name: 'p', sources: ['guolu'] });
    const res = await app.inject({
      method: 'PATCH', url: `/api/projects/${created.id}`, payload: { sources: ['guolu', 'shangzhong'] },
    });
    assert.equal(res.statusCode, 200);
  });

  it('PATCH re-validates sources against granted (400) without applying a partial patch', async () => {
    const created = await createProject(TENANT, { name: '守规', sources: ['guolu'] });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${created.id}`,
      payload: { name: '想改名', sources: ['duanjian'] },
    });
    assert.equal(res.statusCode, 400);
    const stored = await getProject(TENANT, created.id);
    assert.ok(stored);
    assert.equal(stored.name, '守规');
    assert.deepEqual(stored.sources, ['guolu']);
  });

  it('PATCH with neither name nor sources is a 400', async () => {
    const created = await createProject(TENANT, { name: '空补丁', sources: ['guolu'] });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${created.id}`,
      payload: {},
    });
    assert.equal(res.statusCode, 400);
  });

  it('PATCH on a managed row is rejected with 403 and leaves the row untouched', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${guoluDefaultId}`,
      payload: { name: '篡改' },
    });
    assert.equal(res.statusCode, 403);
    const stored = await getProject(TENANT, guoluDefaultId);
    assert.ok(stored);
    assert.equal(stored.name, '锅炉厂');
  });

  it('DELETE on a managed row is rejected with 403 and does not disable it', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/api/projects/${guoluDefaultId}` });
    assert.equal(res.statusCode, 403);
    const stored = await getProject(TENANT, guoluDefaultId);
    assert.ok(stored);
    assert.equal(stored.enabled, true);
  });

  it('DELETE disables a user project: gone from the list, still in the store disabled', async () => {
    const created = await createProject(TENANT, { name: '要删的', sources: ['shangzhong'] });
    const res = await app.inject({ method: 'DELETE', url: `/api/projects/${created.id}` });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { ok: true });

    const list = await app.inject({ method: 'GET', url: '/api/projects' });
    const listed = (list.json() as { projects: { id: string }[] }).projects;
    assert.ok(!listed.some((p) => p.id === created.id), 'disabled project must leave the list');

    // Disabled, never deleted — pins to it now deny, history stays.
    const stored = await getProject(TENANT, created.id);
    assert.ok(stored, 'row must survive DELETE');
    assert.equal(stored.enabled, false);

    // PATCH after delete reads as not-found (client-side the project is gone).
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${created.id}`,
      payload: { name: '还魂' },
    });
    assert.equal(patch.statusCode, 404);
  });

  it('foreign-tenant ids read as 404 on PATCH and DELETE, and never appear in GET', async () => {
    const foreign = await createProject(FOREIGN_TENANT, { name: '别家的', sources: ['guolu'] });

    const list = await app.inject({ method: 'GET', url: '/api/projects' });
    const listed = (list.json() as { projects: { id: string }[] }).projects;
    assert.ok(!listed.some((p) => p.id === foreign.id));

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${foreign.id}`,
      payload: { name: '抢改' },
    });
    assert.equal(patch.statusCode, 404);

    const del = await app.inject({ method: 'DELETE', url: `/api/projects/${foreign.id}` });
    assert.equal(del.statusCode, 404);

    const stored = await getProject(FOREIGN_TENANT, foreign.id);
    assert.ok(stored);
    assert.equal(stored.name, '别家的');
    assert.equal(stored.enabled, true);
  });

  // ---- 项目文件夹(spec 2026-08-14)-------------------------------------
  // folder 既不是身份也不是范围,是**本机偏好** —— 所以 managed 项目(guolu、上重
  // 这些默认项目,恰恰是用户真正在用的)也必须能设,否则这个功能对他们等于不存在。

  it('给项目绑一个文件夹', async () => {
    const p = await createProject(TENANT, { name: '带文件夹的', sources: ['guolu'] });
    const dir = mkdtempSync(join(tmpdir(), 'veylin-projroute-'));
    try {
      const res = await app.inject({
        method: 'PATCH', url: `/api/projects/${p.id}`, payload: { folder: dir },
      });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal((await getProject(TENANT, p.id))!.folder, dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('managed 项目也能绑文件夹 —— 名字和场景仍然锁着', async () => {
    const managed = await createProject(TENANT, {
      name: '受管的', sources: ['guolu'], managed: true,
    });
    const dir = mkdtempSync(join(tmpdir(), 'veylin-projroute-'));
    try {
      const ok = await app.inject({
        method: 'PATCH', url: `/api/projects/${managed.id}`, payload: { folder: dir },
      });
      assert.equal(ok.statusCode, 200);
      assert.equal((await getProject(TENANT, managed.id))!.folder, dir);

      const denied = await app.inject({
        method: 'PATCH', url: `/api/projects/${managed.id}`, payload: { name: '改名' },
      });
      assert.equal(denied.statusCode, 403, '身份与范围仍归 reconciler 管');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('文件夹必须是存在的绝对路径 —— 否则用户会以为绑好了,其实什么都不会落下来', async () => {
    const p = await createProject(TENANT, { name: '坏路径', sources: ['guolu'] });
    for (const bad of ['relative/path', '/definitely/not/here/veylin-nope']) {
      const res = await app.inject({
        method: 'PATCH', url: `/api/projects/${p.id}`, payload: { folder: bad },
      });
      assert.equal(res.statusCode, 400, bad);
    }
    assert.equal((await getProject(TENANT, p.id))!.folder, undefined);
  });

  it('项目说明能写能改 —— 它会作为项目级指令喂给模型', async () => {
    const created = (await app.inject({
      method: 'POST', url: '/api/projects',
      payload: { name: '带说明的项目', sources: [] },
    })).json() as { project: { id: string } };

    const res = await app.inject({
      method: 'PATCH', url: `/api/projects/${created.project.id}`,
      payload: { instructions: '只看锻件分厂,别碰冶铸。' },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(
      (res.json() as { project: { instructions?: string } }).project.instructions,
      '只看锻件分厂,别碰冶铸。',
    );
  });

  it('**managed 项目也能写说明** —— 它是项目意图,不是身份或范围', async () => {
    const list = (await app.inject({ method: 'GET', url: '/api/projects' })).json() as {
      projects: Array<{ id: string; managed: boolean }>;
    };
    const managed = list.projects.find((p) => p.managed);
    if (!managed) return;  // 这套 fixture 里没有 managed 行就跳过
    const res = await app.inject({
      method: 'PATCH', url: `/api/projects/${managed.id}`,
      payload: { instructions: '这个厂的口径…' },
    });
    assert.equal(res.statusCode, 200, res.body);
  });

  it('**新建时填的说明要存下来** —— 只在 PATCH 里认会让它静默丢掉', async () => {
    // 实测发现:对话框那个框看起来完全正常,填了、创建了、什么都没报错,
    // 但值没进去 —— 而项目说明是要喂给模型的,丢了就是行为悄悄不对。
    const res = await app.inject({
      method: 'POST', url: '/api/projects',
      payload: { name: '带说明新建', sources: [], instructions: '只看锻件分厂。' },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(
      (res.json() as { project: { instructions?: string } }).project.instructions,
      '只看锻件分厂。',
    );
  });
});
