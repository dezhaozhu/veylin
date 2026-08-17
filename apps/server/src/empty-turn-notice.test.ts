/**
 * **一轮什么都没产出,就得明说。**
 *
 * 已经栽了两次,病因完全不同、症状一模一样(界面空白,用户以为"对话没了"):
 *  1. 历史里悬空的前端 tool call → 每轮空 step;
 *  2. 附件 file part 重放 → provider 抛 UnsupportedFunctionality,而 Mastra 把
 *     错误 log 完就 return,我们的 catch 压根不触发。
 *
 * 所以这张网**不认病因**:只看这一轮有没有产出可见内容。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EMPTY_TURN_NOTICE, isVisibleStreamPart, shouldReportEmptyTurn } from './empty-turn-notice.js';

describe('空轮次', () => {
  it('正文/工具/推理都算产出', () => {
    for (const type of ['text-delta', 'tool-input-start', 'tool-output-available', 'reasoning-delta']) {
      assert.equal(isVisibleStreamPart({ type }), true, type);
    }
  });

  it('骨架 chunk 不算产出 —— 空轮次里有的正是这些', () => {
    for (const type of ['start', 'start-step', 'finish-step', 'finish', 'data-veylin-step-boundary']) {
      assert.equal(isVisibleStreamPart({ type }), false, type);
    }
  });

  it('**什么都没产出 → 报出来**', () => {
    assert.equal(shouldReportEmptyTurn({ sawVisibleOutput: false }), true);
  });

  it('**挂起不是空轮次** —— 它正等着人回答,报错反而是噪音', () => {
    assert.equal(shouldReportEmptyTurn({ sawVisibleOutput: false, sawSuspension: true }), false);
  });

  it('**用户自己按停的不报** —— 那是他要的结果', () => {
    assert.equal(shouldReportEmptyTurn({ sawVisibleOutput: false, aborted: true }), false);
  });

  it('**已经报过错就不再叠一句** —— 一个事实一处表达', () => {
    assert.equal(shouldReportEmptyTurn({ sawVisibleOutput: false, sawError: true }), false);
  });

  it('有产出就不报', () => {
    assert.equal(shouldReportEmptyTurn({ sawVisibleOutput: true }), false);
  });

  it('措辞要说人话,并给出下一步 —— 不是一句"未知错误"', () => {
    assert.match(EMPTY_TURN_NOTICE, /没有/);
    assert.ok(EMPTY_TURN_NOTICE.length > 20, '太短了,等于没说');
  });
});
