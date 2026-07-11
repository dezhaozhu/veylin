import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isRepoWatchdogCommand,
  parseWatchdogPid,
  watchdogPidPath,
} from './server-dev-singleton.mjs';

describe('server-dev-singleton', () => {
  it('parses valid pid lines', () => {
    assert.equal(parseWatchdogPid('12345\n'), 12345);
    assert.equal(parseWatchdogPid('  9  '), 9);
    assert.equal(parseWatchdogPid(''), null);
    assert.equal(parseWatchdogPid('abc'), null);
    assert.equal(parseWatchdogPid('0'), null);
    assert.equal(parseWatchdogPid('-1'), null);
  });

  it('builds pid path under data/logs', () => {
    assert.equal(
      watchdogPidPath('/repo/data'),
      '/repo/data/logs/server-dev-watchdog.pid',
    );
  });

  it('recognizes this repo watchdog cmdline', () => {
    const root = '/Users/zdz/Downloads/Code/compass/Veylin';
    assert.equal(
      isRepoWatchdogCommand(
        `node ${root}/apps/desktop/scripts/run-server-dev.mjs`,
        root,
      ),
      true,
    );
    assert.equal(
      isRepoWatchdogCommand('node /other/clone/apps/desktop/scripts/run-server-dev.mjs', root),
      false,
    );
    assert.equal(isRepoWatchdogCommand('node /tmp/unrelated.js', root), false);
    assert.equal(isRepoWatchdogCommand('', root), false);
  });
});
