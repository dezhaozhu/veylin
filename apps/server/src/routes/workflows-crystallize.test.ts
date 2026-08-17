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
