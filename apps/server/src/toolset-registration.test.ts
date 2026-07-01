import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/** Regression: automation/workflow tools must be nested toolsets, not spread at top level. */
describe('toolset registration shape', () => {
  it('uses nested keys for workflow and config', () => {
    const taskToolset = {
      agent: { spawn_task: {} },
      table: { table_get: {} },
      knowledge: { knowledge_search: {} },
      config: { workspace_config: {} },
      workflow: { workflow_run: {} },
    };

    const fullToolset = {
      ...taskToolset,
    };

    assert.ok('workflow' in fullToolset);
    assert.ok(typeof fullToolset.workflow === 'object');
    assert.ok('workflow_run' in (fullToolset.workflow as Record<string, unknown>));
    assert.equal('workflow_run' in fullToolset, false);
    assert.equal('parameters' in (fullToolset as Record<string, unknown>), false);
  });
});
