import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getPanelTabDisplayLabel } from './panel-tab-label';
import type { PanelTab } from './panel-types';

const t = (key: string) => {
  const map: Record<string, string> = {
    'panels.table.label': '表格',
    'panels.web.label': '网页',
    'panels.rag.label': '知识库',
    'panels.workflow.label': '工作流',
  };
  return map[key] ?? key;
};

describe('panel-tab-label', () => {
  it('uses kind label for table; hostname/title for web', () => {
    assert.equal(
      getPanelTabDisplayLabel(
        { id: 't', kind: 'table', title: 'panels.table.label' } satisfies PanelTab,
        t,
      ),
      '表格',
    );
    assert.equal(
      getPanelTabDisplayLabel(
        {
          id: 'w',
          kind: 'web',
          title: 'panels.web.label',
          state: { url: 'https://example.com/path', title: 'Example' },
        },
        t,
      ),
      'Example',
    );
    assert.equal(
      getPanelTabDisplayLabel(
        {
          id: 'w2',
          kind: 'web',
          title: 'panels.web.label',
          state: { url: 'https://intranet.test/' },
        },
        t,
      ),
      'intranet.test',
    );
  });
});
