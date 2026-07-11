import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { matcherMatches, ifConditionMatches } from './matcher.js';
import { parseHooksFile } from './schema.js';
import { normalizeHookJson, parseHookStdout } from './runners/command.js';
import { HookBus } from './bus.js';
import type { LoadedHookHandler } from './schema.js';

describe('matcher', () => {
  it('matches exact and regex', () => {
    assert.equal(matcherMatches('Bash', 'Bash'), true);
    assert.equal(matcherMatches('Edit|Write', 'Write'), true);
    assert.equal(matcherMatches('mcp__.*', 'mcp__memory__search'), true);
    assert.equal(matcherMatches('Bash', 'Edit'), false);
  });

  it('evaluates if conditions on tool events', () => {
    assert.equal(
      ifConditionMatches('PreToolUse', 'Bash(rm *)', {
        tool_name: 'Bash',
        tool_input: { command: 'rm -rf /tmp' },
      }),
      true,
    );
    assert.equal(
      ifConditionMatches('Stop', 'Bash(rm *)', { tool_name: 'Bash' }),
      false,
    );
  });
});

describe('parseHooksFile', () => {
  it('accepts wrapped and bare configs', () => {
    const wrapped = parseHooksFile({
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'true' }] }],
      },
    });
    assert.ok(wrapped.PreToolUse?.length === 1);

    const bare = parseHooksFile({
      Stop: [{ hooks: [{ type: 'prompt', prompt: 'done?' }] }],
    });
    assert.ok(bare.Stop?.length === 1);
  });
});

describe('parseHookStdout', () => {
  it('parses Claude-style deny', () => {
    const r = parseHookStdout(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: 'blocked',
        },
      }),
      0,
    );
    assert.equal(r.decision, 'deny');
    assert.equal(r.reason, 'blocked');
  });

  it('exit 2 denies', () => {
    assert.equal(parseHookStdout('', 2).decision, 'deny');
  });
});

describe('HookBus', () => {
  it('merges deny from prompt evaluator', async () => {
    const bus = new HookBus({
      evaluatePrompt: async () => ({ decision: 'deny', reason: 'no' }),
    });
    const handlers: LoadedHookHandler[] = [
      {
        event: 'Stop',
        handler: { type: 'prompt', prompt: 'ok?' },
        source: 'user',
        enabled: true,
        dormant: false,
      },
    ];
    bus.setHandlers(handlers);
    const result = await bus.emit('Stop', {});
    assert.equal(result.decision, 'deny');
    assert.equal(result.reason, 'no');
  });

  it('marks dormant events unsupported when handlers exist', async () => {
    const bus = new HookBus();
    bus.setHandlers([
      {
        event: 'WorktreeCreate',
        handler: { type: 'command', command: 'true' },
        source: 'user',
        enabled: true,
        dormant: true,
      },
    ]);
    const result = await bus.emit('WorktreeCreate', {});
    assert.equal(result.unsupported, true);
    assert.equal(result.dormant, true);
  });
});

describe('normalizeHookJson', () => {
  it('maps continue:false to deny', () => {
    assert.equal(normalizeHookJson({ continue: false }).decision, 'deny');
  });
});
