/**
 * Unit tests for the MCP tool-schema sanitizer (draft-07 tuple `items` → strict
 * draft-2020-12 single-schema `items`) — see mcp-store.ts for why this exists
 * (litellm rejects the whole tool-calling request over one bad schema).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeJsonSchemaNode, sanitizeMcpToolsets } from './mcp-store.js';

test('元组 items(同质)合并为单一子 schema', () => {
  const out = sanitizeJsonSchemaNode({
    type: 'array',
    items: [{ type: 'number' }, { type: 'number' }, { type: 'number' }],
  }) as { items: unknown };
  assert.deepEqual(out.items, { type: 'number' });
});

test('元组 items(异质)改写为 anyOf', () => {
  const out = sanitizeJsonSchemaNode({
    type: 'array',
    items: [{ type: 'string' }, { type: 'number' }],
  }) as { items: { anyOf: unknown } };
  assert.deepEqual(out.items, { anyOf: [{ type: 'string' }, { type: 'number' }] });
});

test('空元组 items 改写为 {}', () => {
  const out = sanitizeJsonSchemaNode({ type: 'array', items: [] }) as { items: unknown };
  assert.deepEqual(out.items, {});
});

test('正常 schema(非元组)深等于原值 — no-op', () => {
  const schema = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
    },
    required: ['name'],
  };
  const out = sanitizeJsonSchemaNode(schema);
  assert.deepEqual(out, schema);
});

test('data 位置 — default 内的 items 数组原样保留,不当 schema 改写', () => {
  const schema = {
    type: 'object',
    default: { items: [1, 2, 3] },
  };
  const out = sanitizeJsonSchemaNode(schema) as { default: unknown };
  assert.deepEqual(out.default, { items: [1, 2, 3] });
});

test('data 位置 — examples 内的 items 数组原样保留', () => {
  const schema = {
    type: 'object',
    examples: [{ items: [1, 2, 3] }, { items: ['a', 'b'] }],
  };
  const out = sanitizeJsonSchemaNode(schema) as { examples: unknown };
  assert.deepEqual(out.examples, [{ items: [1, 2, 3] }, { items: ['a', 'b'] }]);
});

test('data 位置 — const 内的 items 数组原样保留', () => {
  const schema = {
    type: 'object',
    const: { items: [1, 2, 3] },
  };
  const out = sanitizeJsonSchemaNode(schema) as { const: unknown };
  assert.deepEqual(out.const, { items: [1, 2, 3] });
});

test('data 位置 — enum 成员内的 items 数组原样保留', () => {
  const schema = {
    type: 'object',
    enum: [{ items: [1, 2, 3] }, { items: [4, 5] }],
  };
  const out = sanitizeJsonSchemaNode(schema) as { enum: unknown };
  assert.deepEqual(out.enum, [{ items: [1, 2, 3] }, { items: [4, 5] }]);
});

test('data 位置以外的同名 items 仍正常改写(default 与真实 tuple items 并存)', () => {
  const schema = {
    type: 'array',
    items: [{ type: 'number' }, { type: 'string' }],
    default: { items: [1, 2, 3] },
  };
  const out = sanitizeJsonSchemaNode(schema) as { items: unknown; default: unknown };
  assert.deepEqual(out.items, { anyOf: [{ type: 'number' }, { type: 'string' }] });
  assert.deepEqual(out.default, { items: [1, 2, 3] });
});

test('additionalItems 在元组 items 改写时被清除', () => {
  const schema = {
    type: 'array',
    items: [{ type: 'number' }, { type: 'number' }],
    additionalItems: false,
  };
  const out = sanitizeJsonSchemaNode(schema) as Record<string, unknown>;
  assert.deepEqual(out.items, { type: 'number' });
  assert.equal('additionalItems' in out, false);
});

test('additionalItems 与非元组 items(单一 schema)并存时保留', () => {
  const schema = {
    type: 'array',
    items: { type: 'number' },
    additionalItems: false,
  };
  const out = sanitizeJsonSchemaNode(schema) as Record<string, unknown>;
  assert.deepEqual(out.items, { type: 'number' });
  assert.equal(out.additionalItems, false);
});

/** Minimal fake of a mastra tool schema wrapper: `~standard.jsonSchema.{input,output}(opts)`. */
function fakeStandardSchemaTool(inputJsonSchema: Record<string, unknown>) {
  let inputCalls = 0;
  const jsonSchema = {
    input: (..._args: unknown[]) => {
      inputCalls++;
      return inputJsonSchema;
    },
  };
  const inputSchema = { '~standard': { version: 1, vendor: 'mastra', jsonSchema } };
  return {
    tool: { id: 'demo_tool', description: 'demo', inputSchema, outputSchema: undefined },
    getInputCalls: () => inputCalls,
  };
}

test('sanitizeMcpToolsets 包装 ~standard.jsonSchema.input,输出经过 sanitize', () => {
  const { tool, getInputCalls } = fakeStandardSchemaTool({
    type: 'object',
    properties: {
      point: { type: 'array', items: [{ type: 'number' }, { type: 'number' }, { type: 'number' }] },
    },
  });
  const toolsets = { demoServer: { demo_tool: tool } };
  sanitizeMcpToolsets(toolsets);

  const wrappedInput = (
    tool.inputSchema as { '~standard': { jsonSchema: { input: (...args: unknown[]) => unknown } } }
  )['~standard'].jsonSchema.input;
  const result = wrappedInput() as {
    properties: { point: { items: unknown } };
  };
  assert.deepEqual(result.properties.point.items, { type: 'number' });
  assert.equal(getInputCalls(), 1);
});

test('sanitizeMcpToolsets 对缺失 outputSchema 的正常情况保持静默(fail-open, 无 schema 可 sanitize)', () => {
  const { tool } = fakeStandardSchemaTool({ type: 'object', properties: {} });
  const toolsets = { demoServer: { demo_tool: tool } };
  // Should not throw even though outputSchema is undefined (the common case for MCP tools).
  assert.doesNotThrow(() => sanitizeMcpToolsets(toolsets));
});
