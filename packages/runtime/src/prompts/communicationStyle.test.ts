import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  COMMUNICATION_STYLE_SECTION,
  buildCommunicationStyleSection,
} from './communicationStyle.js';
import { composeInstructions } from './systemPrompt.js';

describe('communicationStyle', () => {
  it('exports a non-empty section', () => {
    assert.ok(COMMUNICATION_STYLE_SECTION.includes('End-of-turn summary'));
    assert.ok(buildCommunicationStyleSection().includes('Communicating with the user'));
  });

  it('appends explanatory mode when requested', () => {
    const section = buildCommunicationStyleSection('explanatory');
    assert.match(section, /Explanatory mode/);
  });

  it('is merged into composeInstructions', () => {
    const instructions = composeInstructions('You are a test agent.');
    assert.match(instructions, /Communicating with the user/);
    assert.match(instructions, /Your role/);
  });
});
