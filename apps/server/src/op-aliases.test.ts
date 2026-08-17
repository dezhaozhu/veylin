/**
 * 工序名对照表:**文档里的叫法 ↔ 系统里的叫法**。
 *
 * 真数据打脸:上重 11 个文档工序名只有 2 个能一字不差对上。文档说「最终验收」,
 * 系统里是「最终检验」;文档说「锻造」,系统里是一串「焊后热处理/预热处理…」。
 * 现在的输出是一堆诚实但没用的"查不到"。
 *
 * 形状照红线提名那条走过的路:**候选 → 人确认 → 落库复用**。
 * 三条不让步的:
 * 1. **只认人确认过的。** 近似名只能当候选提出来,不能自动生效 —— 自动配对一旦
 *    配错,后面所有结论都错在一个没人看过的假设上。
 * 2. **别名是有方向的**:文档词 → 系统词。反过来用会把系统的真名替换成文档的土话。
 * 3. **一个文档词只能指一个系统词。** 指两个就等于没指,而且会静默选一个。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applyAliases, mergeAlias, type OpAliases } from './op-aliases.js';

const aliases: OpAliases = {
  最终验收: { system: '最终检验', confirmedBy: '老王', at: '2026-08-17T00:00:00Z' },
};

describe('applyAliases', () => {
  it('文档词换成系统词', () => {
    assert.equal(applyAliases('最终验收', aliases), '最终检验');
  });

  it('没登记过的原样返回 —— 不猜', () => {
    assert.equal(applyAliases('锻造', aliases), '锻造');
  });

  it('**方向是单向的**:拿系统词进来不会被换成文档词', () => {
    assert.equal(applyAliases('最终检验', aliases), '最终检验');
  });

  it('空表不炸', () => {
    assert.equal(applyAliases('随便', {}), '随便');
  });
});

describe('mergeAlias —— 人确认之后落库', () => {
  it('新增一条', () => {
    const out = mergeAlias({}, { doc: '最终验收', system: '最终检验', by: '老王' });
    assert.equal(out.aliases['最终验收']!.system, '最终检验');
    assert.ok(out.aliases['最终验收']!.confirmedBy);
  });

  it('**改指向要说出来** —— 静默覆盖等于把之前所有基于旧别名的结论作废而不告诉人', () => {
    const out = mergeAlias(aliases, { doc: '最终验收', system: '联合验收', by: '老李' });
    assert.match(out.note ?? '', /原来指向|改/);
    assert.match(out.note ?? '', /最终检验/);
    assert.equal(out.aliases['最终验收']!.system, '联合验收');
  });

  it('原样重复登记 = 什么也没变,并说清楚', () => {
    const out = mergeAlias(aliases, { doc: '最终验收', system: '最终检验', by: '老王' });
    assert.match(out.note ?? '', /本来就是|没有变化/);
  });

  it('**自己指自己要拒** —— 那不是别名,是噪音', () => {
    assert.throws(() => mergeAlias({}, { doc: '锻造', system: '锻造', by: 'x' }), /同一个/);
  });

  it('空值要拒', () => {
    assert.throws(() => mergeAlias({}, { doc: '', system: 'x', by: 'y' }));
    assert.throws(() => mergeAlias({}, { doc: 'x', system: '  ', by: 'y' }));
  });
});

describe('落盘', () => {
  it('**存在项目文件夹里**(.veylin/op-aliases.json)—— 跟着项目走,人能直接打开看', async () => {
    const { mkdtempSync, rmSync, existsSync, readFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { readAliases, writeAliases } = await import('./op-aliases.js');
    const dir = mkdtempSync(join(tmpdir(), 'alias-'));
    try {
      assert.deepEqual(await readAliases(dir), {}, '没有文件时该是空表,不是报错');
      await writeAliases(dir, { 最终验收: { system: '最终检验', confirmedBy: '老王', at: 'now' } });
      assert.ok(existsSync(join(dir, '.veylin', 'op-aliases.json')));
      assert.equal((await readAliases(dir)).最终验收!.system, '最终检验');
      // 人能读:不是一坨压缩 JSON
      assert.ok(readFileSync(join(dir, '.veylin', 'op-aliases.json'), 'utf8').includes('\n'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('文件坏了当空表 —— 一个手改坏的 JSON 不该让整条对照失败', async () => {
    const { mkdtempSync, rmSync, mkdirSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { readAliases } = await import('./op-aliases.js');
    const dir = mkdtempSync(join(tmpdir(), 'alias-'));
    try {
      mkdirSync(join(dir, '.veylin'), { recursive: true });
      writeFileSync(join(dir, '.veylin', 'op-aliases.json'), '{ 坏掉的');
      assert.deepEqual(await readAliases(dir), {});
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
