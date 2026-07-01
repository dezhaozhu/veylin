import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  deriveTaskLabel,
  extractTaskPromptDirective,
  formatTaskDisplayName,
} from './task-display.js';

describe('task display labels', () => {
  it('extracts directive from subagent envelope', () => {
    const prompt = [
      'You are the "explore" subagent dispatched by a parent agent to handle one scoped task.',
      '',
      'Task:',
      'Summarize column semantics in Sheet 1',
    ].join('\n');
    assert.equal(extractTaskPromptDirective(prompt), 'Summarize column semantics in Sheet 1');
  });

  it('prefers unique description over preset key', () => {
    assert.equal(
      formatTaskDisplayName({
        id: 't1',
        label: '表格字段分析',
        agentId: 'subagent-explore',
        subagentType: 'explore',
      }),
      '表格字段分析',
    );
  });

  it('falls back to prompt directive when label duplicates preset', () => {
    const prompt = 'Task:\nCheck knowledge base for WBS definitions\n';
    assert.equal(
      formatTaskDisplayName({
        id: 't2',
        label: 'explore',
        agentId: 'subagent-explore',
        subagentType: 'explore',
        prompt,
      }),
      'Check knowledge base for WBS definitions',
    );
  });

  it('derives stored label from prompt when description omitted', () => {
    assert.equal(
      deriveTaskLabel({
        prompt: 'Analyze duplicate WBS rows in the main sheet',
        subagentType: 'explore',
        agentId: 'subagent-explore',
        defaultLabel: 'explore',
      }),
      'Analyze duplicate WBS rows in the main sheet',
    );
  });
});
