import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { desktopThreadPruneAction } from './thread-state.js';

describe('desktopThreadPruneAction', () => {
  it('worker threads still drop', () => {
    assert.equal(
      desktopThreadPruneAction({
        threadId: 'subagent-1',
        resourceId: 'dev-user',
        installId: 'install-1',
        hasMessages: true,
      }),
      'drop',
    );
  });

  it('empty leftovers drop', () => {
    assert.equal(
      desktopThreadPruneAction({
        threadId: '__LOCALID_abc',
        resourceId: 'dev-user',
        installId: 'install-1',
        hasMessages: false,
      }),
      'drop',
    );
  });

  it('old dev-user chats with messages are adopted, not deleted', () => {
    assert.equal(
      desktopThreadPruneAction({
        threadId: '__LOCALID_Wu8vCGc',
        resourceId: 'dev-user',
        installId: '414664cc-a3c1-4c38-afd6-98810fe03114',
        hasMessages: true,
      }),
      'adopt',
    );
  });

  it('already on this install stays', () => {
    assert.equal(
      desktopThreadPruneAction({
        threadId: '__LOCALID_abc',
        resourceId: 'install-1',
        installId: 'install-1',
        hasMessages: true,
      }),
      'keep',
    );
  });
});
