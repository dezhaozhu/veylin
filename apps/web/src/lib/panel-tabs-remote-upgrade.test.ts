import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isPanelTabsRemoteUpgrade } from './panel-tabs-remote-upgrade.ts';

describe('panel tabs remote upgrade detection', () => {
  it('treats same list-item gaining remoteId as upgrade', () => {
    assert.equal(
      isPanelTabsRemoteUpgrade({
        prevLocalId: 'local-1',
        localId: 'local-1',
        prevThreadId: 'local-1',
        remoteId: 'remote-1',
        threadId: 'remote-1',
      }),
      true,
    );
  });

  it('does not treat switching to another remote thread as upgrade', () => {
    // New empty chat (local only) → click yesterday's session (already remote).
    assert.equal(
      isPanelTabsRemoteUpgrade({
        prevLocalId: 'local-new',
        localId: 'local-old',
        prevThreadId: 'local-new',
        remoteId: 'remote-old',
        threadId: 'remote-old',
      }),
      false,
    );
  });

  it('does not treat switching between two remotes as upgrade', () => {
    assert.equal(
      isPanelTabsRemoteUpgrade({
        prevLocalId: 'local-a',
        localId: 'local-b',
        prevThreadId: 'remote-a',
        remoteId: 'remote-b',
        threadId: 'remote-b',
      }),
      false,
    );
  });
});
