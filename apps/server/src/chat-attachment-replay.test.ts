/**
 * **附件在第二轮会把整条对话毒死。**
 *
 * 真事(2026-08-17,用户本地):拖进一个 xlsx + 一个 docx 问了两件事,第一轮答得
 * 好好的;顺着回了一句之后,**之后每一轮都是空白** —— 界面上就是"对话又没了"。
 * 服务端日志里是这一句:
 *
 *   Error in agent stream: 'file part media type application/octet-stream'
 *   functionality not supported.
 *
 * 分岔在 toAgentMessages:第一轮历史里还没有 tool call,走 fileParts —— 它把每个
 * 附件抽成文本/图片,绝不把原始二进制交出去。第一轮一旦调了工具,第二轮
 * `messageHasModelToolParts` 就为真,改走 convertToModelMessages,**原样**把那个
 * file part 递给 provider,当场抛。
 *
 * 一个分支滤、另一个不滤 —— 于是附件成了历史里的一颗毒丸:只要它还在,后面
 * 每一轮都死,而且用户只看到空白。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { toAgentMessages } from './chat.js';

const xlsxDataUrl = async () => {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.json_to_sheet([{ 组件: '轴承', 数量: 3 }]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '开发组件');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  // 浏览器给 xlsx 的 mediaType 常常就是 octet-stream —— 日志里那句报错的原文。
  return `data:application/octet-stream;base64,${buf.toString('base64')}`;
};

/** 第二轮的真实形状:用户消息带附件,助手消息里已经有一次工具调用。 */
const replayHistory = async () => [
  {
    id: 'u1', role: 'user',
    parts: [
      { type: 'text', text: '看下开发组件能不能加个日期列' },
      { type: 'file', url: await xlsxDataUrl(), filename: 'taobao_开发组件.xlsx',
        mediaType: 'application/octet-stream' },
    ],
  },
  {
    id: 'a1', role: 'assistant',
    parts: [
      { type: 'text', text: '我先看看有哪些表' },
      { type: 'tool-table_list_sheets', toolCallId: 'c1', state: 'output-available',
        input: {}, output: { sheets: [] } },
    ],
  },
  { id: 'u2', role: 'user', parts: [{ type: 'text', text: '列名就是日期,今天的' }] },
];

const flatten = (content: unknown): Array<Record<string, unknown>> =>
  Array.isArray(content) ? (content as Array<Record<string, unknown>>) : [];

describe('带附件的对话重放到模型', () => {
  it('**不能把 provider 不认的 file part 递出去** —— 那正是空白轮次的来源', async () => {
    const out = await toAgentMessages((await replayHistory()) as never);
    const bad = out.flatMap((m) => flatten(m.content)).filter(
      (p) => p.type === 'file' &&
        !String((p as { mediaType?: string }).mediaType ?? '').startsWith('image/'),
    );
    assert.deepEqual(bad, [], `递出去了 provider 不认的附件:${JSON.stringify(bad).slice(0, 200)}`);
  });

  it('**附件内容不能就此消失** —— 它还得以文本形式留在上下文里', async () => {
    const out = await toAgentMessages((await replayHistory()) as never);
    const all = JSON.stringify(out);
    assert.match(all, /开发组件/, '附件被丢干净了 —— 模型会以为用户从没发过这个文件');
  });

  it('图片仍然原样带过去 —— 那是 provider 认的,不该被一起清掉', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const out = await toAgentMessages([
      { id: 'u1', role: 'user',
        parts: [{ type: 'text', text: '看这张图' },
                { type: 'file', url: png, filename: 'a.png', mediaType: 'image/png' }] },
      { id: 'a1', role: 'assistant',
        parts: [{ type: 'tool-x', toolCallId: 'c1', state: 'output-available',
                  input: {}, output: {} }] },
    ] as never, true);
    assert.match(JSON.stringify(out), /image/);
  });
});
