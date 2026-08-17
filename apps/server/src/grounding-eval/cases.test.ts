/**
 * 黄金样本的规矩(照搬 compass_eval 的 cases.py):每条必须写 why,且 why 要写
 * "凭什么",不是"是什么"。校验抓不到的缺陷(过时的 why、样本不具代表性)只能人工重推。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GROUNDING_CASES } from './cases.js';

describe('grounding cases', () => {
  it('has 9 cases with unique ids', () => {
    assert.equal(GROUNDING_CASES.length, 9);
    assert.equal(new Set(GROUNDING_CASES.map((c) => c.id)).size, 9);
  });

  it('every case declares a non-trivial why', () => {
    for (const c of GROUNDING_CASES) {
      assert.ok(c.why.trim().length >= 20, `${c.id} 的 why 太短`);
    }
  });

  it('every case declares at least one tenant', () => {
    for (const c of GROUNDING_CASES) {
      assert.ok(c.tenants.length > 0, `${c.id} 未声明适用租户`);
    }
  });

  it('every case has a non-empty question', () => {
    for (const c of GROUNDING_CASES) {
      assert.ok(c.question.trim().length > 0, `${c.id} 无问题文本`);
    }
  });

  it('G4 forbids self-service solving', () => {
    const g4 = GROUNDING_CASES.find((c) => c.id === 'G4');
    assert.ok(g4);
    assert.equal(g4?.forbidSolve, true);
  });

  it('G3 runs only where the K is actually guessed', () => {
    const g3 = GROUNDING_CASES.find((c) => c.id === 'G3');
    assert.deepEqual(g3?.tenants, ['shangzhong']);
  });

  it('G9 explicitly authorises the shadow solve it asks for, so it is not forbidSolve', () => {
    const g9 = GROUNDING_CASES.find((c) => c.id === 'G9');
    assert.ok(g9);
    assert.notEqual(g9?.forbidSolve, true);
    // The point of G9 is to give scopedDisclosed a legitimate trigger path —
    // that only works if the question actually names the order it targets.
    assert.ok(g9?.question.includes('Z-221524A0760111'));
  });
});
