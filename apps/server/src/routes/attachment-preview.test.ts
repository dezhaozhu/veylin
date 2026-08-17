/**
 * 聊天里拖进来的文件也要能点开看 —— 走**和项目文件预览同一套回参**
 * (`text` / `overview` / `note`),否则前端要为两种来源写两套显示逻辑。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import Fastify from 'fastify';
import JSZip from 'jszip';

import { registerAttachmentRoutes } from './attachments.js';

const build = () => {
  const app = Fastify({ bodyLimit: 40 * 1024 * 1024 });
  registerAttachmentRoutes(app, { resolveContext: async () => ({ tenantId: 'T' }) } as never);
  return app;
};

const post = (payload: unknown) =>
  build().inject({ method: 'POST', url: '/api/attachment/preview', payload: payload as object });

describe('POST /api/attachment/preview', () => {
  it('pptx → 正文,带页码', async () => {
    const zip = new JSZip();
    zip.file('ppt/slides/slide1.xml', '<p:sld xmlns:a="a"><a:p><a:r><a:t>八月底交付</a:t></a:r></a:p></p:sld>');
    const buf = (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
    const res = await post({
      name: '汇报.pptx',
      data: `data:application/x;base64,${buf.toString('base64')}`,
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { text?: string };
    assert.match(body.text ?? '', /第 1 页/);
    assert.match(body.text ?? '', /八月底交付/);
  });

  it('**没有内容就说没有,不回一个空的 200 假装看过了**', async () => {
    const res = await post({ name: 'x.pptx', data: 'data:application/x;base64,eHg=' });
    const body = res.json() as { kind?: string; error?: string; note?: string };
    assert.ok(body.error ?? body.note, '读不了却什么也没说');
  });

  it('缺参数 → 400', async () => {
    assert.equal((await post({ name: 'x.pptx' })).statusCode, 400);
  });

  it('**不认 data 以外的 URL** —— 让服务端按前端给的地址去取,等于把它变成代理', async () => {
    const res = await post({ name: 'x.pptx', data: 'http://10.0.0.1/secret' });
    assert.equal(res.statusCode, 400);
  });
});

/**
 * 界面上那个「撤销这次修改」要有东西可调 —— 工具是 agent 用的,人点按钮走 REST。
 */
describe('POST /api/project/document/rollback', () => {
  const build2 = () => {
    const app = Fastify();
    registerAttachmentRoutes(app, { resolveContext: async () => ({ tenantId: 'T' }) } as never);
    return app;
  };
  const post = (payload: unknown) =>
    build2().inject({ method: 'POST', url: '/api/project/document/rollback', payload: payload as object });

  it('缺 name 或 to → 400', async () => {
    assert.equal((await post({ projectId: 'p' })).statusCode, 400);
    assert.equal((await post({ projectId: 'p', name: 'a.docx' })).statusCode, 400);
  });

  it('**退到第 0 版要拒** —— 第 1 版是副本刚建立那版,没有更早的', async () => {
    const res = await post({ projectId: 'p', name: 'a.docx', to: 0 });
    assert.equal(res.statusCode, 400);
  });
});
