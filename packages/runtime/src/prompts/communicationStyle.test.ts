import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  COMMUNICATION_STYLE_SECTION,
  buildCommunicationStyleSection,
} from './communicationStyle.js';
import { BASE_SYSTEM_PROMPT, composeInstructions } from './systemPrompt.js';
import { buildAgentOrchestrationBlock } from './agentOrchestration.js';

describe('communicationStyle', () => {
  it('exports a non-empty section', () => {
    assert.ok(COMMUNICATION_STYLE_SECTION.includes('End-of-turn summary'));
    assert.ok(buildCommunicationStyleSection().includes('Communicating with the user'));
  });

  it('includes effort matching and adaptive reflection', () => {
    assert.match(COMMUNICATION_STYLE_SECTION, /Effort matching/);
    assert.match(COMMUNICATION_STYLE_SECTION, /think thoroughly/i);
    assert.match(COMMUNICATION_STYLE_SECTION, /Adaptive missed-item reflection/);
    assert.match(COMMUNICATION_STYLE_SECTION, /do \*\*not\*\* force a reflection/i);
  });

  it('appends explanatory mode when requested', () => {
    const section = buildCommunicationStyleSection('explanatory');
    assert.match(section, /Explanatory mode/);
    assert.match(section, /think thoroughly/i);
  });

  it('is merged into composeInstructions', () => {
    const instructions = composeInstructions('You are a test agent.');
    assert.match(instructions, /Communicating with the user/);
    assert.match(instructions, /Your role/);
    assert.match(instructions, /do \*\*not\*\* use emojis/i);
    assert.match(instructions, /blast radius/i);
    assert.match(instructions, /Report outcomes truthfully/i);
  });
});

describe('BASE_SYSTEM_PROMPT', () => {
  it('bans emojis unless the user asks and hardens tool failure rules', () => {
    assert.match(BASE_SYSTEM_PROMPT, /do \*\*not\*\* use emojis/i);
    assert.match(BASE_SYSTEM_PROMPT, /do not blindly repeat/i);
    assert.match(BASE_SYSTEM_PROMPT, /do not retry the same call unchanged/i);
    assert.match(BASE_SYSTEM_PROMPT, /one or two direct read-only/i);
  });
});

describe('buildAgentOrchestrationBlock', () => {
  it('includes dispatch heuristics and self-contained worker prompts', () => {
    const block = buildAgentOrchestrationBlock(['custom-a']);
    assert.match(block, /Directed lookups/);
    assert.match(block, /do \*\*not\*\* spawn a `task`/);
    assert.match(block, /self-contained|do \*\*not\*\* see this parent/i);
    assert.match(block, /do \*\*not\*\* redo the same read-only/i);
    assert.match(block, /custom-a/);
  });
});
