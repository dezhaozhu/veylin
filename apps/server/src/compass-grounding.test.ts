/**
 * 接地块的注入条件。伪造 Compass MCP toolset,仿 schedule-edit.test.ts —— 无 DB、无网络。
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { compassGroundingBlock, COMPASS_GROUNDING_TEXT } from './compass-grounding.js';

const toolsetsWith = (names: string[]) => () => ({
  compass: Object.fromEntries(names.map((n) => [n, { execute: async () => ({}) }])),
});

afterEach(() => {
  delete process.env['VEYLIN_COMPASS_GROUNDING'];
});

describe('compassGroundingBlock', () => {
  it('is empty when compass is not connected', () => {
    assert.equal(compassGroundingBlock(() => ({})), '');
  });

  it('is empty when the getter is undefined', () => {
    assert.equal(compassGroundingBlock(undefined), '');
  });

  it('injects for a read-only principal (get_health only, no edit tools)', () => {
    const block = compassGroundingBlock(toolsetsWith(['get_health']));
    assert.equal(block, COMPASS_GROUNDING_TEXT);
  });

  it('is empty when VEYLIN_COMPASS_GROUNDING=0', () => {
    process.env['VEYLIN_COMPASS_GROUNDING'] = '0';
    assert.equal(compassGroundingBlock(toolsetsWith(['get_health'])), '');
  });

  it('stays on for any other switch value', () => {
    process.env['VEYLIN_COMPASS_GROUNDING'] = '1';
    assert.notEqual(compassGroundingBlock(toolsetsWith(['get_health'])), '');
  });

  it('resolves through the project pin, not a hardcoded compass key', () => {
    const getToolsets = () => ({
      'compass-guolu': { get_health: { execute: async () => ({}) } },
    });
    const groups = { 'compass-guolu': 'compass' };
    assert.notEqual(compassGroundingBlock(getToolsets, groups, 'compass-guolu'), '');
  });

  it('does not inject when the pinned server lacks compass tools', () => {
    const getToolsets = () => ({ 'compass-guolu': {} });
    const groups = { 'compass-guolu': 'compass' };
    assert.equal(compassGroundingBlock(getToolsets, groups, 'compass-guolu'), '');
  });
});

describe('COMPASS_GROUNDING_TEXT', () => {
  it('names every shape rule it must cover', () => {
    for (const needle of [
      'get_cockpit',
      'honest_status',
      'show_shadow',
      'preview_schedule_edit',
      'unscheduled',
    ]) {
      assert.ok(COMPASS_GROUNDING_TEXT.includes(needle), `missing ${needle}`);
    }
  });

  it('forbids the bare-confidence phrasing it exists to prevent', () => {
    assert.match(COMPASS_GROUNDING_TEXT, /不输出裸可信度数字/);
  });

  it('carries no emoji', () => {
    assert.doesNotMatch(COMPASS_GROUNDING_TEXT, /\p{Extended_Pictographic}/u);
  });
});
