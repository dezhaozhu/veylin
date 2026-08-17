/**
 * 聊天里拖进来的附件 —— 点开看一眼。
 *
 * **和项目文件预览同一套回参**(`text` / `overview` / `note`):同一份 xlsx,
 * 从项目文件夹点开和从聊天里点开,看到的东西必须一样,前端也不该为"它从哪儿
 * 进来的"写两套显示逻辑。
 *
 * 只认 data URL:让服务端照前端给的地址去取,等于顺手把本机变成一个代理 ——
 * 内网地址、file:// 都会跟着能读。这里不需要那个能力。
 */
import type { FastifyInstance } from 'fastify';

import { extractDocument } from '../document-extract.js';
import type { ServerDeps } from './types.js';

function decodeDataUrl(url: string): Buffer | null {
  const comma = url.indexOf(',');
  if (!url.startsWith('data:') || comma < 0) return null;
  if (!url.slice(5, comma).includes('base64')) return null;
  try {
    return Buffer.from(url.slice(comma + 1), 'base64');
  } catch {
    return null;
  }
}

export function registerAttachmentRoutes(app: FastifyInstance, _deps: ServerDeps): void {
  app.post('/api/attachment/preview', async (req, reply) => {
    const body = (req.body ?? {}) as { name?: string; data?: string };
    const name = body.name?.trim();
    if (!name || !body.data) {
      reply.code(400);
      return { error: '缺少 name 或 data' };
    }
    const bytes = decodeDataUrl(body.data);
    if (!bytes) {
      reply.code(400);
      return { error: '只接受 data URL 形式的文件内容' };
    }
    const out = await extractDocument(name, bytes, { limit: 400 });
    if (out.kind === 'unsupported') {
      // 200 + 说明,不是 500:"这类文件看不了"是一个正常答案,不是故障。
      return { ok: true, kind: out.kind, note: out.notice ?? '这个文件看不了' };
    }
    return { ok: true, ...out, ...(out.notice ? { note: out.notice } : {}) };
  });
}
