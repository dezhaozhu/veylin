/**
 * 防漂移:插件路径的 data-honesty.md 必须是 COMPASS_GROUNDING_TEXT 的渲染产物。
 * 复用生成器自身的渲染函数 —— 测试绝不自拼期望文本,否则就是造了第二个来源。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderDataHonestyDoc, DATA_HONESTY_DOC_PATH } from './compass-refs.js';
import { COMPASS_GROUNDING_TEXT } from './compass-grounding.js';

describe('compass references drift', () => {
  it('data-honesty.md matches the rendered canonical text', () => {
    assert.equal(
      readFileSync(DATA_HONESTY_DOC_PATH, 'utf8'),
      renderDataHonestyDoc(COMPASS_GROUNDING_TEXT),
    );
  });

  it('the rendered doc carries the do-not-edit header', () => {
    assert.match(renderDataHonestyDoc('x'), /请勿手改此文件/);
  });
});
