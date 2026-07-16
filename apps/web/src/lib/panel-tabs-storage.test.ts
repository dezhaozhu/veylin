import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

function installMemoryStorage(): void {
  const store = new Map<string, string>();
  const memoryStorage = {
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
    removeItem(key: string) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: memoryStorage,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'window', {
    value: globalThis,
    configurable: true,
  });
}

describe('panel-tabs-storage per-thread', () => {
  beforeEach(() => {
    installMemoryStorage();
  });

  it('defaults to empty workspace for unknown thread', async () => {
    const {
      loadThreadPanelTabs,
      setLivePanelThread,
      emptyPanelTabsState,
    } = await import('./panel-tabs-storage.ts');
    setLivePanelThread(null, emptyPanelTabsState());
    assert.deepEqual(loadThreadPanelTabs('thread-a'), { tabs: [], activeId: null });
  });

  it('persists and reloads tabs per thread', async () => {
    const { loadThreadPanelTabs, saveThreadPanelTabs, emptyPanelTabsState } =
      await import('./panel-tabs-storage.ts');
    saveThreadPanelTabs('t1', {
      tabs: [
        {
          id: 'tab_1',
          kind: 'web',
          title: 'panels.web.label',
          state: { url: 'https://example.com', title: 'Example' },
        },
      ],
      activeId: 'tab_1',
    });
    saveThreadPanelTabs('t2', emptyPanelTabsState());

    assert.equal(loadThreadPanelTabs('t1').tabs.length, 1);
    assert.equal(loadThreadPanelTabs('t1').activeId, 'tab_1');
    assert.deepEqual(loadThreadPanelTabs('t2'), { tabs: [], activeId: null });
  });

  it('migrates local id bucket to remote id', async () => {
    const { loadThreadPanelTabs, saveThreadPanelTabs, migrateThreadPanelTabs } =
      await import('./panel-tabs-storage.ts');
    saveThreadPanelTabs('local-1', {
      tabs: [{ id: 'tab_x', kind: 'table', title: 'panels.table.label' }],
      activeId: 'tab_x',
    });
    migrateThreadPanelTabs('local-1', 'remote-1');

    assert.equal(loadThreadPanelTabs('local-1').tabs.length, 0);
    assert.equal(loadThreadPanelTabs('remote-1').tabs[0]?.id, 'tab_x');
  });

  it('ignores legacy global key (no migration)', async () => {
    localStorage.setItem(
      'right_panel_tabs',
      JSON.stringify({
        tabs: [{ id: 'legacy', kind: 'rag', title: 'panels.rag.label' }],
        activeId: 'legacy',
      }),
    );

    const mod = await import(`./panel-tabs-storage.ts?t=${Date.now()}`);
    const loaded = mod.loadThreadPanelTabs('current-thread');
    assert.deepEqual(loaded, { tabs: [], activeId: null });
    // Stale key may remain; we simply do not read it.
    assert.equal(localStorage.getItem('right_panel_tabs_by_thread'), null);
  });

  it('dedupes singleton kinds but keeps multiple web tabs', async () => {
    const { loadThreadPanelTabs, saveThreadPanelTabs } = await import(
      './panel-tabs-storage.ts'
    );
    saveThreadPanelTabs('dup', {
      tabs: [
        { id: 't1', kind: 'table', title: 'panels.table.label', state: { sheetId: 's1' } },
        { id: 'w1', kind: 'web', title: 'panels.web.label', state: { url: 'https://a.test' } },
        { id: 't2', kind: 'table', title: 'panels.table.label', state: { sheetId: 's2' } },
        { id: 'w2', kind: 'web', title: 'panels.web.label', state: { url: 'https://b.test' } },
      ],
      activeId: 't2',
    });
    const loaded = loadThreadPanelTabs('dup');
    assert.equal(loaded.tabs.filter((t) => t.kind === 'table').length, 1);
    assert.equal(loaded.tabs.find((t) => t.kind === 'table')?.id, 't2');
    assert.equal(loaded.tabs.filter((t) => t.kind === 'web').length, 2);
    assert.equal(loaded.activeId, 't2');
  });

  it('live pointer drives getActiveWebTabId and workspace context', async () => {
    const {
      setLivePanelThread,
      getActiveWebTabId,
      readWorkspacePanelContext,
      readPanelTabsState,
    } = await import('./panel-tabs-storage.ts');
    setLivePanelThread('t1', {
      tabs: [
        {
          id: 'web1',
          kind: 'web',
          title: 'panels.web.label',
          state: { url: 'https://a.test', title: 'A' },
        },
      ],
      activeId: 'web1',
    });
    assert.equal(getActiveWebTabId(), 'web1');
    assert.deepEqual(readWorkspacePanelContext(), {
      activePanel: 'web',
      webUrl: 'https://a.test',
      webTitle: 'A',
    });
    assert.equal(readPanelTabsState()?.activeId, 'web1');
  });
});
