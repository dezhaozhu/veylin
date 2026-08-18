import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { toolPartName } from './tool-part-name';

describe('toolPartName', () => {
  it('新形状:名字编在 type 里', () => {
    assert.equal(toolPartName({ type: 'tool-get_gantt' }), 'get_gantt');
  });

  it('老形状:独立的 toolName 字段', () => {
    assert.equal(toolPartName({ type: 'tool-call', toolName: 'get_gantt' }), 'get_gantt');
  });

  it('两者都有时以 toolName 为准', () => {
    assert.equal(toolPartName({ type: 'tool-x', toolName: 'get_cockpit' }), 'get_cockpit');
  });

  it('`tool-call`/`tool-result` 是形状标签,不是工具名', () => {
    assert.equal(toolPartName({ type: 'tool-call' }), null);
    assert.equal(toolPartName({ type: 'tool-result' }), null);
  });

  it('不是工具片段就回 null', () => {
    assert.equal(toolPartName({ type: 'text' }), null);
    assert.equal(toolPartName(null), null);
    assert.equal(toolPartName('tool-get_gantt'), null);
  });
});
