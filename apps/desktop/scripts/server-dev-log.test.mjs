import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  rotateServerDevLogIfNeeded,
  serverDevLogPath,
} from './server-dev-log.mjs';

describe('server-dev-log rotation', () => {
  it('builds the default log path', () => {
    assert.equal(serverDevLogPath('/repo/data/logs'), '/repo/data/logs/server-dev.log');
  });

  it('does nothing when the log is under the size limit', () => {
    const dir = join(tmpdir(), `veylin-log-rotate-${Date.now()}-small`);
    mkdirSync(dir, { recursive: true });
    const logPath = join(dir, 'server-dev.log');
    writeFileSync(logPath, 'hello\n');
    assert.equal(rotateServerDevLogIfNeeded(logPath, { maxBytes: 1024, keep: 2 }), false);
    assert.equal(existsSync(logPath), true);
    assert.equal(readFileSync(logPath, 'utf8'), 'hello\n');
    rmSync(dir, { recursive: true, force: true });
  });

  it('rotates oversized logs and keeps N history files', () => {
    const dir = join(tmpdir(), `veylin-log-rotate-${Date.now()}-big`);
    mkdirSync(dir, { recursive: true });
    const logPath = join(dir, 'server-dev.log');
    writeFileSync(logPath, 'a'.repeat(200));
    writeFileSync(`${logPath}.1`, 'old-1');

    assert.equal(rotateServerDevLogIfNeeded(logPath, { maxBytes: 100, keep: 2 }), true);
    assert.equal(existsSync(logPath), false);
    assert.equal(readFileSync(`${logPath}.1`, 'utf8'), 'a'.repeat(200));
    assert.equal(readFileSync(`${logPath}.2`, 'utf8'), 'old-1');

    rmSync(dir, { recursive: true, force: true });
  });
});
