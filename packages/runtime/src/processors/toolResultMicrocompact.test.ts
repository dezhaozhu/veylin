import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { MastraDBMessage } from '@mastra/core/memory';
import {
  ToolResultMicrocompact,
  MICROCOMPACT_TOOL_WHITELIST,
} from './toolResultMicrocompact.js';

function toolResultMessage(toolName: string, text: string, index: number): MastraDBMessage {
  return {
    id: `tool-${index}`,
    role: 'tool',
    createdAt: new Date(),
    content: {
      parts: [{ type: 'tool-result', toolName, text }],
    },
  } as unknown as MastraDBMessage;
}

function assistantToolCall(index: number): MastraDBMessage {
  return {
    id: `assistant-${index}`,
    role: 'assistant',
    createdAt: new Date(),
    content: {
      parts: [{ type: 'tool-call', toolName: 'knowledge_search' }],
    },
  } as unknown as MastraDBMessage;
}

describe('ToolResultMicrocompact', () => {
  it('whitelists read-only tools', () => {
    assert.ok(MICROCOMPACT_TOOL_WHITELIST.has('knowledge_search'));
    assert.ok(!MICROCOMPACT_TOOL_WHITELIST.has('todo_write'));
  });

  it('clears old whitelisted tool results but keeps recent rounds', async () => {
    const processor = new ToolResultMicrocompact({ keepRounds: 1 });
    const longText = 'x'.repeat(200);
    const messages: MastraDBMessage[] = [
      assistantToolCall(0),
      toolResultMessage('knowledge_search', longText, 0),
      assistantToolCall(1),
      toolResultMessage('knowledge_search', longText, 1),
    ];

    const out = await processor.processInput({ messages });
    const oldPart = (out[1] as { content: { parts: { text?: string }[] } }).content.parts[0];
    const recentPart = (out[3] as { content: { parts: { text?: string }[] } }).content.parts[0];

    assert.match(oldPart?.text ?? '', /Earlier tool result cleared/);
    assert.equal(recentPart?.text, longText);
  });

  it('skips non-whitelisted tools', async () => {
    const processor = new ToolResultMicrocompact({ keepRounds: 0 });
    const longText = 'y'.repeat(200);
    const messages: MastraDBMessage[] = [
      assistantToolCall(0),
      toolResultMessage('todo_write', longText, 0),
    ];

    const out = await processor.processInput({ messages });
    const part = (out[1] as { content: { parts: { text?: string }[] } }).content.parts[0];
    assert.equal(part?.text, longText);
  });
});
