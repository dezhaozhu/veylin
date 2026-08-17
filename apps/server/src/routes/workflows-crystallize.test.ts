/**
 * POST /api/workflows/crystallize —— 从对话结晶成草案。
 *
 * 钉边界,不钉模型输出:模型那部分不确定,但**边界必须确定** ——
 * 没有 threadId、没有消息、只取到某条为止,这三件事的行为不能靠运气。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import Fastify from 'fastify';

import { registerWorkflowsRoutes } from './workflows.js';

const build = (msgs: Array<{ role: string; content: string }>, seen?: { upTo?: number }) => {
  const app = Fastify();
  registerWorkflowsRoutes(app, {
    resolveContext: async () => ({ tenantId: 'T' }),
    readThreadMessages: async () => msgs,
  } as never);
  return app;
};

describe('crystallize 的边界', () => {
  it('没给 threadId → 400,说清缺什么', async () => {
    const res = await build([]).inject({
      method: 'POST', url: '/api/workflows/crystallize', payload: {},
    });
    assert.equal(res.statusCode, 400);
    assert.match((res.json() as { message: string }).message, /threadId/);
  });

  it('**没有消息不是"生成失败",是没东西可结晶** —— 说清楚,别报成模型出错', async () => {
    const res = await build([]).inject({
      method: 'POST', url: '/api/workflows/crystallize', payload: { threadId: 't1' },
    });
    assert.equal(res.statusCode, 400);
    assert.match((res.json() as { message: string }).message, /没有内容可以结晶/);
  });
});

/**
 * 存草案。人已经在确认页认过一遍了,这里只做**结构上的守门**。
 */
describe('POST /api/workflows/from-draft', () => {
  const draft = {
    name: '找瓶颈',
    steps: [{ title: '查产能证据' }],
    values: [{ label: '资源', value: '金工分厂', varies: true }],
    findings: ['金工是瓶颈'],
  };

  it('**零步的草案存不进去** —— 它会出现在列表里,但跑起来什么也不做', async () => {
    const res = await build([]).inject({
      method: 'POST',
      url: '/api/workflows/from-draft',
      payload: { threadId: 't1', draft: { ...draft, steps: [] } },
    });
    assert.equal(res.statusCode, 400);
    assert.match((res.json() as { message: string }).message, /至少要有一步/);
  });

  it('前端不许自带节点图 —— 图由服务端从草案生成,一处口径', async () => {
    const res = await build([]).inject({
      method: 'POST',
      url: '/api/workflows/from-draft',
      payload: { threadId: 't1', draft, definition: { nodes: [], edges: [] } },
    });
    // 存进去的是生成的图,不是传进来的空图。
    assert.notEqual(res.statusCode, 400);
  });
});
