import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import {
  addUserHook,
  removeUserHookByKey,
  readUserHooksConfig,
} from './user-hooks-store.js';
import { hookIdentityKey, loadAllHooks } from './loader.js';

describe('user hooks store', () => {
  const dirs: string[] = [];

  after(async () => {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  });

  it('adds and removes handlers in hooks.json', async () => {
    const home = await mkdtemp(join(tmpdir(), 'veylin-hooks-'));
    dirs.push(home);
    const veylinHome = join(home, '.veylin');

    const { key } = await addUserHook({
      event: 'PreToolUse',
      matcher: 'Bash',
      handler: { type: 'command', command: 'echo ok' },
      veylinHome,
      homeDir: home,
    });

    const cfg = await readUserHooksConfig(veylinHome, home);
    assert.equal(cfg.PreToolUse?.length, 1);
    assert.equal(cfg.PreToolUse?.[0]?.hooks[0]?.type, 'command');

    const loaded = await loadAllHooks({
      homeDir: home,
      veylinHome,
      importClaudeHooks: false,
    });
    assert.ok(loaded.some((h) => hookIdentityKey(h) === key));

    const removed = await removeUserHookByKey({ key, veylinHome, homeDir: home });
    assert.equal(removed, true);
    const afterCfg = await readUserHooksConfig(veylinHome, home);
    assert.equal(afterCfg.PreToolUse, undefined);
  });
});
