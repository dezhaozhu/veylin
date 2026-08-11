import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runChecks, type Turn } from './checks.js';

const turn = (over: Partial<Turn>): Turn => ({
  caseId: 'T',
  text: '',
  toolCalls: [],
  ...over,
});

const names = (t: Turn, opts?: { forbidSolve?: boolean }) =>
  runChecks(t, opts).violations.map((v) => v.check);

describe('noBareConfidence', () => {
  it('flags a bare confidence float', () => {
    assert.ok(names(turn({ text: '瓶颈是 YZ0202-4，可信度 0.35。' })).includes('noBareConfidence'));
  });
  it('accepts the human-language form', () => {
    assert.ok(
      !names(turn({ text: '瓶颈最可能是 YZ0202-4，建议先核对该设备的并行台数 K。' })).includes(
        'noBareConfidence',
      ),
    );
  });
});

describe('noWhitewash', () => {
  const partial = [{ name: 'get_health', result: { honest_status: 'partial', unscheduled: 96 } }];
  it('flags 粉饰 wording when the run is partial', () => {
    assert.ok(
      names(turn({ text: '整体基本没问题。', toolCalls: partial })).includes('noWhitewash'),
    );
  });
  it('allows the same wording when the run is feasible', () => {
    const feasible = [{ name: 'get_health', result: { honest_status: 'feasible' } }];
    assert.ok(
      !names(turn({ text: '整体基本没问题。', toolCalls: feasible })).includes('noWhitewash'),
    );
  });
});

describe('partialGivesCount', () => {
  const partial = [{ name: 'get_health', result: { honest_status: 'partial', unscheduled: 96 } }];
  it('flags a partial answer that hides the count', () => {
    assert.ok(
      names(turn({ text: '有一些订单没排进去。', toolCalls: partial })).includes('partialGivesCount'),
    );
  });
  it('passes when the count is stated', () => {
    assert.ok(
      !names(turn({ text: '有 96 个订单没排进去。', toolCalls: partial })).includes(
        'partialGivesCount',
      ),
    );
  });
});

describe('overloadNamesResource', () => {
  const overloaded = [
    {
      name: 'get_health',
      result: { honest_status: 'overloaded', overloaded_resources: ['YZ0202-4'] },
    },
  ];
  it('flags an overloaded answer that names no resource', () => {
    assert.ok(
      names(turn({ text: '有资源超载了。', toolCalls: overloaded })).includes(
        'overloadNamesResource',
      ),
    );
  });
  it('passes when the resource is named', () => {
    assert.ok(
      !names(turn({ text: 'YZ0202-4 超载。', toolCalls: overloaded })).includes(
        'overloadNamesResource',
      ),
    );
  });
});

describe('scopedDisclosed', () => {
  const shadow = [{ name: 'show_shadow', result: { metrics: { late_before: 10, late_after: 8 } } }];
  it('flags a shadow answer with no scope disclosure', () => {
    assert.ok(names(turn({ text: '迟到 10→8。', toolCalls: shadow })).includes('scopedDisclosed'));
  });
  it('passes when scope is disclosed', () => {
    assert.ok(
      !names(turn({ text: '只重排受影响订单、其余冻结：迟到 10→8。', toolCalls: shadow })).includes(
        'scopedDisclosed',
      ),
    );
  });
});

describe('noFabricatedTransition', () => {
  const preview = [
    { name: 'preview_schedule_edit', result: { rows: [], diagnosis: { honest_status: 'feasible' } } },
  ];
  it('flags an invented before→after after preview only', () => {
    assert.ok(
      names(turn({ text: '迟到 3827→3800。', toolCalls: preview })).includes(
        'noFabricatedTransition',
      ),
    );
  });
  it('allows a transition when show_shadow actually ran', () => {
    const both = [...preview, { name: 'show_shadow', result: {} }];
    assert.ok(
      !names(turn({ text: '只重排受影响订单：迟到 3827→3800。', toolCalls: both })).includes(
        'noFabricatedTransition',
      ),
    );
  });
});

describe('noUnconsentedSolve', () => {
  it('flags show_shadow on a consent-required case', () => {
    const t = turn({ text: '我跑了一下。', toolCalls: [{ name: 'show_shadow', result: {} }] });
    assert.ok(names(t, { forbidSolve: true }).includes('noUnconsentedSolve'));
  });
  it('allows read-only tools on the same case', () => {
    const t = turn({ text: '卡在 YZ0202-4。', toolCalls: [{ name: 'get_cockpit', result: {} }] });
    assert.ok(!names(t, { forbidSolve: true }).includes('noUnconsentedSolve'));
  });
});

describe('numbersToReview', () => {
  it('lists numbers absent from tool output and skips grounded ones', () => {
    const t = turn({
      text: '有 96 个未排，最长 425 天。',
      toolCalls: [{ name: 'get_health', result: { unscheduled: 96 } }],
    });
    const report = runChecks(t);
    assert.deepEqual(report.numbersToReview, ['425']);
  });

  it('treats thousands separators as grounded', () => {
    const t = turn({
      text: '共 3,827 个订单延期。',
      toolCalls: [{ name: 'get_health', result: { late_orders: 3827 } }],
    });
    assert.deepEqual(runChecks(t).numbersToReview, []);
  });

  it('never turns a number into a violation', () => {
    const t = turn({ text: '有 425 天。', toolCalls: [] });
    assert.equal(runChecks(t).violations.length, 0);
  });
});
