import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SCENE_CARD_TOOL, sceneCardArgs, sceneCardColumns } from './scene-card-grid';

describe('scene-card-grid', () => {
  it('a server without get_scene_card contributes no column and no error', () => {
    // Mocked GET /api/mcp-apps/tools byServer: compass declares the card
    // widget, another capability server declares only an unrelated widget.
    const byServer = {
      compass: { [SCENE_CARD_TOOL]: 'ui://compass/scene-card.html', get_gantt: 'ui://compass/gantt.html' },
      'other-server': { some_widget: 'ui://other/widget.html' },
    };
    const columns = sceneCardColumns(byServer);
    assert.deepEqual(columns, [
      { server: 'compass', resourceUri: 'ui://compass/scene-card.html' },
    ]);
  });

  it('no server with get_scene_card ⇒ empty grid, not a failure', () => {
    assert.deepEqual(sceneCardColumns({ a: { tool: 'ui://a/x.html' } }), []);
    assert.deepEqual(sceneCardColumns({}), []);
  });

  it('tolerates a missing byServer map (failed tools fetch ⇒ no columns)', () => {
    assert.deepEqual(sceneCardColumns(undefined), []);
    assert.deepEqual(sceneCardColumns(null), []);
  });

  it('ignores non-string resource uris', () => {
    const byServer = {
      broken: { [SCENE_CARD_TOOL]: 42 as unknown as string },
    };
    assert.deepEqual(sceneCardColumns(byServer), []);
  });

  it('columns are sorted by server name for a stable layout', () => {
    const byServer = {
      zeta: { [SCENE_CARD_TOOL]: 'ui://z/card.html' },
      alpha: { [SCENE_CARD_TOOL]: 'ui://a/card.html' },
    };
    assert.deepEqual(
      sceneCardColumns(byServer).map((c) => c.server),
      ['alpha', 'zeta'],
    );
  });

  it('single-source project calls get_scene_card with {} (v2b may omit scene)', () => {
    assert.deepEqual(sceneCardArgs(['guolu'], 'guolu'), {});
  });

  it('multi-source project names the scene per cell', () => {
    assert.deepEqual(sceneCardArgs(['guolu', 'shangzhong'], 'shangzhong'), {
      scene: 'shangzhong',
    });
  });
});
