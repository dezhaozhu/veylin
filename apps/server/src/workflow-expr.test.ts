import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateCase,
  evaluateCompare,
  interpolate,
  interpolateDeep,
  resolvePath,
  resolveValue,
} from './workflow-expr';

const ctx = {
  n1: { status: 'overdue', count: 3, rows: [{ order: 'A' }, { order: 'B' }] },
  n2: { text: 'hello world' },
};

test('resolvePath nested + array index', () => {
  assert.equal(resolvePath(ctx.n1, 'rows.0.order'), 'A');
  assert.equal(resolvePath(ctx.n1, 'count'), 3);
  assert.equal(resolvePath(ctx.n1, 'missing.x'), undefined);
});

test('resolveValue: bare expression returns raw value', () => {
  assert.deepEqual(resolveValue(ctx, '{{ n1.rows }}'), ctx.n1.rows);
  assert.equal(resolveValue(ctx, '{{ n1.count }}'), 3);
});

test('interpolate: mixed string', () => {
  assert.equal(interpolate('status={{ n1.status }} c={{ n1.count }}', ctx), 'status=overdue c=3');
});

test('interpolateDeep over object', () => {
  const out = interpolateDeep({ a: '{{ n2.text }}', b: ['{{ n1.count }}'] }, ctx) as Record<string, unknown>;
  assert.equal(out.a, 'hello world');
  assert.deepEqual(out.b, [3]);
});

test('evaluateCompare operators', () => {
  assert.equal(evaluateCompare('overdue', 'is', 'overdue'), true);
  assert.equal(evaluateCompare('hello world', 'contains', 'world'), true);
  assert.equal(evaluateCompare(3, 'gt', '2'), true);
  assert.equal(evaluateCompare(3, 'lte', '3'), true);
  assert.equal(evaluateCompare('', 'is_empty', ''), true);
  assert.equal(evaluateCompare('a', 'in', 'a,b,c'), true);
  assert.equal(evaluateCompare(null, 'is_null', ''), true);
});

test('evaluateCase and/or', () => {
  const andCase = {
    caseId: 'c1',
    logicalOperator: 'and' as const,
    conditions: [
      { left: '{{ n1.status }}', operator: 'is' as const, right: 'overdue' },
      { left: '{{ n1.count }}', operator: 'gte' as const, right: '3' },
    ],
  };
  assert.equal(evaluateCase(ctx, andCase), true);

  const orCase = {
    caseId: 'c2',
    logicalOperator: 'or' as const,
    conditions: [
      { left: '{{ n1.status }}', operator: 'is' as const, right: 'normal' },
      { left: '{{ n1.count }}', operator: 'gt' as const, right: '5' },
    ],
  };
  assert.equal(evaluateCase(ctx, orCase), false);
});
