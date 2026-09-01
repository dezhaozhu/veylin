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

  // 回归测试:KNOWN_KINDS 是个手写的白名单,漏一种落盘时那种页签就"刷新即丢"
  // ——doc/3d 曾经这样丢过(见上面那条注释,2026-08-18 修的)。gantt 刚加进来时
  // 也漏了同一个坑,这条测试钉住不再复发。
  it('persists a gantt tab across reload (regression: doc/3d 曾经因为漏在 KNOWN_KINDS 里刷新即丢)', async () => {
    const { loadThreadPanelTabs, saveThreadPanelTabs } = await import('./panel-tabs-storage.ts');
    saveThreadPanelTabs('t-gantt', {
      tabs: [{ id: 'tab_g1', kind: 'gantt', title: 'panels.gantt.label', state: { view: 'resource' } }],
      activeId: 'tab_g1',
    });

    assert.equal(loadThreadPanelTabs('t-gantt').tabs.length, 1);
    assert.equal(loadThreadPanelTabs('t-gantt').tabs[0]?.kind, 'gantt');
    assert.equal(loadThreadPanelTabs('t-gantt').activeId, 'tab_g1');
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
      openWebTabs: [
        {
          tabId: 'web1',
          url: 'https://a.test',
          title: 'A',
          isActive: true,
        },
      ],
    });
    assert.equal(readPanelTabsState()?.activeId, 'web1');
  });

  it('dedupes singleton panel kinds while keeping multiple web tabs', async () => {
    const { loadThreadPanelTabs, saveThreadPanelTabs } = await import(
      './panel-tabs-storage.ts'
    );
    saveThreadPanelTabs('t-dup', {
      tabs: [
        { id: 'table-old', kind: 'table', title: 'Sheet A' },
        { id: 'web-1', kind: 'web', title: 'panels.web.label', state: { url: 'https://1.test' } },
        { id: 'table-new', kind: 'table', title: 'Sheet B' },
        { id: 'web-2', kind: 'web', title: 'panels.web.label', state: { url: 'https://2.test' } },
        { id: 'rag-1', kind: 'rag', title: 'panels.rag.label' },
        { id: 'rag-2', kind: 'rag', title: 'panels.rag.label' },
      ],
      activeId: 'table-new',
    });
    const loaded = loadThreadPanelTabs('t-dup');
    assert.deepEqual(
      loaded.tabs.map((t) => t.id),
      ['web-1', 'table-new', 'web-2', 'rag-1'],
    );
    assert.equal(loaded.activeId, 'table-new');
  });

  it('lists open web tabs when focused on another panel', async () => {
    const { setLivePanelThread, readWorkspacePanelContext } = await import(
      './panel-tabs-storage.ts'
    );
    setLivePanelThread('t2', {
      tabs: [
        { id: 'table-1', kind: 'table', title: 'Sheet' },
        {
          id: 'web-a',
          kind: 'web',
          title: 'panels.web.label',
          state: { url: 'https://a.test', title: 'A' },
        },
        {
          id: 'web-b',
          kind: 'web',
          title: 'panels.web.label',
          state: { url: 'https://b.test', title: 'B' },
        },
      ],
      activeId: 'table-1',
    });
    const ctx = readWorkspacePanelContext();
    assert.equal(ctx?.activePanel, 'table');
    assert.equal(ctx?.openWebTabs?.length, 2);
    assert.equal(ctx?.openWebTabs?.[0]?.isActive, false);
    assert.equal(ctx?.openWebTabs?.[1]?.tabId, 'web-b');
  });

  it('forces table panel tab title to the kind label', async () => {
    const { loadThreadPanelTabs, saveThreadPanelTabs } = await import(
      './panel-tabs-storage.ts'
    );
    saveThreadPanelTabs('t-table-title', {
      tabs: [
        {
          id: 'table-1',
          kind: 'table',
          title: 'Sheet 9',
          state: { sheetId: 'sheet_9' },
        },
      ],
      activeId: 'table-1',
    });
    assert.equal(loadThreadPanelTabs('t-table-title').tabs[0]?.title, 'panels.table.label');
  });
});

describe('分屏(split)持久化', () => {
  beforeEach(() => {
    installMemoryStorage();
  });

  const twoTabs = [
    { id: 'tab_t', kind: 'table' as const, title: 'panels.table.label', state: { sheetId: 's1' } },
    { id: 'tab_g', kind: 'gantt' as const, title: 'panels.gantt.label' },
  ];

  it('split 随页签一起落盘、一起回来', async () => {
    const { loadThreadPanelTabs, saveThreadPanelTabs } = await import('./panel-tabs-storage.ts');
    saveThreadPanelTabs('t-split', {
      tabs: twoTabs,
      activeId: 'tab_g',
      split: { bottomIds: ['tab_g'], topVisibleId: 'tab_t', bottomVisibleId: 'tab_g', ratio: 0.4 },
    });
    const loaded = loadThreadPanelTabs('t-split');
    assert.deepEqual(loaded.split, {
      bottomIds: ['tab_g'],
      topVisibleId: 'tab_t',
      bottomVisibleId: 'tab_g',
      ratio: 0.4,
    });
  });

  it('坏 split(指向不存在的页签)整个丢掉,页签本身不受影响', async () => {
    const { loadThreadPanelTabs, saveThreadPanelTabs } = await import('./panel-tabs-storage.ts');
    saveThreadPanelTabs('t-bad', {
      tabs: twoTabs,
      activeId: 'tab_t',
      split: { bottomIds: ['tab_zzz'], topVisibleId: 'tab_t', bottomVisibleId: 'tab_zzz', ratio: 0.4 },
    });
    const loaded = loadThreadPanelTabs('t-bad');
    assert.equal(loaded.split, undefined);
    assert.equal(loaded.tabs.length, 2);
  });

  it('singleton 去重删掉的页签在 split 里也一起消失', async () => {
    const { loadThreadPanelTabs, saveThreadPanelTabs } = await import('./panel-tabs-storage.ts');
    // 两个 table(singleton)—— 去重只留 tab_t1;split 指向被删的 tab_t2 → 解除。
    saveThreadPanelTabs('t-dedupe', {
      tabs: [
        { id: 'tab_t1', kind: 'table', title: 'panels.table.label' },
        { id: 'tab_t2', kind: 'table', title: 'panels.table.label' },
        { id: 'tab_w', kind: 'web', title: 'panels.web.label' },
      ],
      activeId: 'tab_t1',
      split: { bottomIds: ['tab_t2'], topVisibleId: 'tab_t1', bottomVisibleId: 'tab_t2', ratio: 0.5 },
    });
    const loaded = loadThreadPanelTabs('t-dedupe');
    assert.equal(loaded.tabs.length, 2);
    assert.equal(loaded.split, undefined);
  });

  it('gantt 也是 singleton:落盘去重和运行时那份集合一致(曾漏)', async () => {
    const { loadThreadPanelTabs, saveThreadPanelTabs } = await import('./panel-tabs-storage.ts');
    saveThreadPanelTabs('t-gantt-dup', {
      tabs: [
        { id: 'tab_g1', kind: 'gantt', title: 'panels.gantt.label' },
        { id: 'tab_g2', kind: 'gantt', title: 'panels.gantt.label' },
        { id: 'tab_w', kind: 'web', title: 'panels.web.label' },
      ],
      activeId: 'tab_g2',
    });
    const loaded = loadThreadPanelTabs('t-gantt-dup');
    assert.deepEqual(loaded.tabs.map((t) => t.id), ['tab_g2', 'tab_w']);
  });

  it('3d 也是 singleton —— viewer3d 的单一全局槽假设「只会有一个 3D 面板」', async () => {
    const { loadThreadPanelTabs, saveThreadPanelTabs } = await import('./panel-tabs-storage.ts');
    saveThreadPanelTabs('t-3d', {
      tabs: [
        { id: 'tab_d1', kind: '3d', title: 'panels.viewer3d.label' },
        { id: 'tab_d2', kind: '3d', title: 'panels.viewer3d.label' },
      ],
      activeId: 'tab_d2',
    });
    assert.deepEqual(loadThreadPanelTabs('t-3d').tabs.map((t) => t.id), ['tab_d2']);
  });

  it('无 split 的旧数据加载后仍然没有 split 键', async () => {
    const { loadThreadPanelTabs, saveThreadPanelTabs } = await import('./panel-tabs-storage.ts');
    saveThreadPanelTabs('t-old', { tabs: twoTabs, activeId: 'tab_t' });
    assert.equal('split' in loadThreadPanelTabs('t-old'), false);
  });
});

describe('在右侧打开一份文档', () => {
  const tabs = [
    { id: 't1', kind: 'table' as const, title: '表格' },
    { id: 'd1', kind: 'doc' as const, title: '工艺.docx', state: { projectId: 'p', name: '工艺.docx' } },
  ];

  it('**同一份文件复用已开的 tab** —— 连点三次开出三个一模一样的 tab,是把"我已经打开它了"讲成三份', async () => {
    const { findDocTab } = await import('./panel-tabs-storage.js');
    assert.equal(findDocTab(tabs, { projectId: 'p', name: '工艺.docx' })?.id, 'd1');
  });

  it('同名但不同项目不算同一份 —— 两个项目里可以各有一份「工艺.docx」', async () => {
    const { findDocTab } = await import('./panel-tabs-storage.js');
    assert.equal(findDocTab(tabs, { projectId: 'q', name: '工艺.docx' }), undefined);
  });

  it('别的 kind 的 tab 不会被当成文档 tab', async () => {
    const { findDocTab } = await import('./panel-tabs-storage.js');
    assert.equal(findDocTab(tabs, { projectId: 'p', name: '表格' }), undefined);
  });
});

/**
 * 图表面板不把整张图的数据写进 localStorage(2026-08-18)。
 *
 * 一张上重的甘特图是 **356 KB**;localStorage 一共约 5 MB,而且这里是**所有线程
 * 共用一个 key**。十来张图就撑满,写失败又被 catch 吞掉 —— 表现是所有面板页签
 * 一起悄悄失去持久化,没有任何报错。
 *
 * 图的数据本来就是"这一轮对话的产物":刷新之后回对话里重开即可,面板自己有
 * 空状态说这句话。所以页签只存**指向哪张图**,不存图。
 */
describe('图表页签不存图本身', () => {
  beforeEach(installMemoryStorage);

  it('落盘时丢掉 part,只留 resourceUri/threadId', async () => {
    const { loadThreadPanelTabs, saveThreadPanelTabs } =
      await import('./panel-tabs-storage.ts');
    const big = { output: { lanes: Array.from({ length: 500 }, (_, i) => ({ id: i })) } };
    saveThreadPanelTabs('t1', {
      activeId: 'w1',
      tabs: [{
        id: 'w1', kind: 'widget', title: '甘特',
        state: { threadId: 't1', resourceUri: 'ui://widget/gantt.html', part: big },
      }],
    } as never);
    const st = ((loadThreadPanelTabs('t1').tabs[0] ?? {}) as { state?: Record<string, unknown> }).state ?? {};
    assert.equal(st.part, undefined, '整张图被写进了 localStorage');
    assert.equal(st.resourceUri, 'ui://widget/gantt.html', '指向哪张图要留着');
  });

  it('别的面板不受影响', async () => {
    const { loadThreadPanelTabs, saveThreadPanelTabs } =
      await import('./panel-tabs-storage.ts');
    saveThreadPanelTabs('t2', {
      activeId: 'd1',
      tabs: [{ id: 'd1', kind: 'doc', title: 'x', state: { projectId: 'p', name: 'a.xlsx' } }],
    } as never);
    const st = ((loadThreadPanelTabs('t2').tabs[0] ?? {}) as { state?: Record<string, unknown> }).state ?? {};
    assert.equal(st.name, 'a.xlsx');
  });
});
