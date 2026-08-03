import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LangfuseMedia } from '@langfuse/core';
import { collectLangfuseAttachments } from './langfuse-attachments.js';

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('collectLangfuseAttachments', () => {
  it('wraps image file parts as LangfuseMedia', () => {
    const attachments = collectLangfuseAttachments([
      {
        parts: [
          {
            type: 'file',
            mediaType: 'image/png',
            filename: 'dot.png',
            url: TINY_PNG,
          },
        ],
      },
    ]);
    assert.equal(attachments.length, 1);
    assert.equal(attachments[0]?.kind, 'media');
    if (attachments[0]?.kind === 'media') {
      assert.ok(attachments[0].media instanceof LangfuseMedia);
      assert.equal(JSON.stringify(attachments[0].media), JSON.stringify(TINY_PNG));
    }
  });

  it('records text preview without uploading media', () => {
    const body = 'hello attachment world';
    const url = `data:text/plain;base64,${Buffer.from(body).toString('base64')}`;
    const attachments = collectLangfuseAttachments([
      {
        parts: [{ type: 'file', mediaType: 'text/plain', filename: 'note.txt', url }],
      },
    ]);
    assert.equal(attachments[0]?.kind, 'text');
    if (attachments[0]?.kind === 'text') {
      assert.equal(attachments[0].preview, body);
    }
  });

  it('skips oversized attachments', () => {
    const huge = `data:image/png;base64,${'A'.repeat(30 * 1024 * 1024)}`;
    const attachments = collectLangfuseAttachments([
      {
        parts: [{ type: 'file', mediaType: 'image/png', filename: 'big.png', url: huge }],
      },
    ]);
    assert.equal(attachments[0]?.kind, 'skipped');
    if (attachments[0]?.kind === 'skipped') {
      assert.equal(attachments[0].reason, 'too_large');
    }
  });
});
