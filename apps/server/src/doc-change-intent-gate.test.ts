/**
 * 这一问怎么进到 `document_edit` 里。
 *
 * **不是拦住不让改** —— 那样每改一句话都要多一轮往返,人会学会无脑点"继续"。
 * 是**改完之后把这一问和对照结论一起回出来**,让人看见"文档改了,系统没改"这件事,
 * 并给出下一步。改本身是可撤销的(版本+回退),所以这里不设闸。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { attachIntent } from './doc-change-intent.js';
import type { Verdict } from './doc-rule-reconcile.js';

const agreeing: Verdict[] = [{
  assertion: { kind: 'op_resource', subject: '粗加工', object: '金工分厂', quote: '| 粗加工 | 金工分厂 |' },
  status: 'agree', detail: '一致:系统里 92% 跑在金工分厂。',
}];

describe('attachIntent', () => {
  it('命中时把这一问挂到结果上,而**不是把 ok 变成 false**', () => {
    const out = attachIntent({ ok: true, revision: 2 }, '| 粗加工 | 金工分厂 |', agreeing);
    assert.equal(out.ok, true);
    assert.equal(out.revision, 2);
    assert.match(String(out.ask_next), /这份文档|那件事/);
  });

  it('没命中就原样返回 —— 不塞一个空字段让模型去猜', () => {
    const out = attachIntent({ ok: true, revision: 2 }, '别的句子', agreeing);
    assert.ok(!('ask_next' in out));
  });

  it('改失败时不问 —— 都没改成,问"改的是什么"是荒谬的', () => {
    const out = attachIntent({ ok: false, error: '锚点有 2 处' }, '| 粗加工 | 金工分厂 |', agreeing);
    assert.ok(!('ask_next' in out));
  });

  it('没有对照结果时不问', () => {
    assert.ok(!('ask_next' in attachIntent({ ok: true }, '| 粗加工 | 金工分厂 |', [])));
  });
});

/**
 * 对照结论得存一下,`document_edit` 才问得出口(对照和改是两次工具调用)。
 * 存的东西会**变旧** —— 文档改过之后,旧结论未必还对得上。
 */
describe('对照结论的暂存', () => {
  it('按 (项目, 文档) 取回', async () => {
    const { rememberVerdicts, recallVerdicts } = await import('./doc-change-intent.js');
    rememberVerdicts('p1', '工艺.docx', agreeing);
    assert.equal(recallVerdicts('p1', '工艺.docx').length, 1);
  });

  it('**换个文档取不到** —— 拿另一份文档的结论来问,问的就是错的东西', async () => {
    const { rememberVerdicts, recallVerdicts } = await import('./doc-change-intent.js');
    rememberVerdicts('p1', '工艺.docx', agreeing);
    assert.equal(recallVerdicts('p1', '别的.docx').length, 0);
  });

  it('**换个项目取不到**', async () => {
    const { rememberVerdicts, recallVerdicts } = await import('./doc-change-intent.js');
    rememberVerdicts('p1', '工艺.docx', agreeing);
    assert.equal(recallVerdicts('p2', '工艺.docx').length, 0);
  });

  it('**过期就当没有** —— 宁可不问,也不拿一份旧结论去问', async () => {
    const { rememberVerdicts, recallVerdicts } = await import('./doc-change-intent.js');
    rememberVerdicts('p1', '旧.docx', agreeing, Date.now() - 40 * 60_000);
    assert.equal(recallVerdicts('p1', '旧.docx').length, 0);
  });
});
