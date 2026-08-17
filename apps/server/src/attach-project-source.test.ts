/**
 * 把数据源挂到当前项目 —— "用了才进 context"那条路的动作那一半。
 *
 * 三条守卫比功能本身重要:
 * - 必须已授权(挂载不能凭空造权限)
 * - 必须钉了项目(没钉就没有"这个项目"可言)
 * - 不替用户挑(挂错厂的后果是他对着另一个工厂的数据做决定,而界面看起来完全正常)
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { closeDb, connectDb } from '@veylin/db';

import { buildTableTools } from './table-tools.js';
import { createProject, getProject } from './project-store.js';
import { DEV_TENANT_ID, ensureDevTenant } from './tenant.js';

before(async () => { await connectDb(); await ensureDevTenant(); });
after(async () => { await closeDb(); });

const ctxFor = (projectId: string | null) => ({
  requestContext: {
    get: (k: string) =>
      k === 'pinnedProjectScope' ? (projectId ? { id: projectId, entryPin: 'compass' } : null)
      : k === 'tenantId' ? DEV_TENANT_ID
      : undefined,
  },
}) as never;

describe('attach_project_source', () => {
  it('**没钉项目就拒** —— 没有"当前项目"时,拒绝比找一个默认的强', async () => {
    const tools = buildTableTools();
    const out = (await tools.attach_project_source.execute!(
      { source: 'guolu' }, ctxFor(null),
    )) as { ok: boolean; error?: string };
    assert.equal(out.ok, false);
    assert.match(out.error ?? '', /没有钉定项目|当前项目/);
  });

  it('挂上之后项目的 sources 里就有它', async () => {
    const p = await createProject(DEV_TENANT_ID, { name: '挂载测试', sources: [] });
    const tools = buildTableTools();
    const out = (await tools.attach_project_source.execute!(
      { source: 'guolu' }, ctxFor(p.id),
    )) as { ok: boolean; sources?: string[] };
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.deepEqual((await getProject(DEV_TENANT_ID, p.id))?.sources, ['guolu']);
  });

  it('重复挂是幂等的,并且明说没改动 —— 不假装做了一次', async () => {
    const p = await createProject(DEV_TENANT_ID, { name: '幂等测试', sources: ['guolu'] });
    const tools = buildTableTools();
    const out = (await tools.attach_project_source.execute!(
      { source: 'guolu' }, ctxFor(p.id),
    )) as { ok: boolean; note?: string };
    assert.equal(out.ok, true);
    assert.match(out.note ?? '', /本来就挂着/);
  });

  it('工具描述要求"用户没指定就先问" —— 这条只能靠措辞守', () => {
    const tools = buildTableTools();
    const desc = String(tools.attach_project_source.description ?? '');
    assert.match(desc, /不要替他挑一个|先问/);
  });
});
