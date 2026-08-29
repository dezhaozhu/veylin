import { expect, test } from '@playwright/test';

type DevPanelState = {
  tabs: Array<{ id: string; kind: string }>;
  activeId: string | null;
  split:
    | { bottomIds: string[]; topVisibleId: string; bottomVisibleId: string; ratio: number }
    | undefined;
};

declare global {
  interface Window {
    __veylinTest?: {
      openPanel: (kind: string) => void;
      moveTabToPane: (kind: string, pane: 'top' | 'bottom') => void;
      panelState: () => DevPanelState;
    };
  }
}

/**
 * 右栏上下分屏(panel-split)。开面板/移 pane 全走 dev hooks(__veylinTest),
 * 几何不进判据 —— 教训见 dev-test-hooks.ts 顶部注释。DOM 断言只认结构锚点:
 * [data-panel-kind](e2e 契约)、[role=separator]、.panel-tab-move。
 */

async function openTwo(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => window.__veylinTest!.openPanel('web'));
  await page.evaluate(() => window.__veylinTest!.openPanel('rag'));
  // 开面板走 React 状态,连续两步之间要等渲染把 panelState 追上。
  await page.waitForFunction(() => window.__veylinTest!.panelState().tabs.length === 2);
}

async function openTwoAndSplit(page: import('@playwright/test').Page): Promise<void> {
  await openTwo(page);
  await page.evaluate(() => window.__veylinTest!.moveTabToPane('rag', 'bottom'));
  await page.waitForFunction(() => Boolean(window.__veylinTest!.panelState().split));
}

test.describe('Right-panel split', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // panelState 属性一装上就存在,但 API 要等 DevPanelOpener 的 effect 注册完
    // —— 「调用不抛」才算就绪。
    await page.waitForFunction(() => {
      try {
        if (!window.__veylinTest?.panelState) return false;
        window.__veylinTest.panelState();
        return true;
      } catch {
        return false;
      }
    });
  });

  test('move down creates the split; move up dissolves it', async ({ page }) => {
    await openTwo(page);
    await expect(page.locator('[data-panel-kind]')).toHaveCount(1);

    await page.evaluate(() => window.__veylinTest!.moveTabToPane('rag', 'bottom'));
    await expect(page.locator('[role="separator"][aria-orientation="horizontal"]')).toBeVisible();
    await expect(page.locator('[data-panel-kind="web"]')).toBeVisible();
    await expect(page.locator('[data-panel-kind="rag"]')).toBeVisible();

    const split = await page.evaluate(() => window.__veylinTest!.panelState().split);
    expect(split?.bottomIds).toHaveLength(1);
    // 手势语义:注意力跟着被移的页签走。
    const state = await page.evaluate(() => window.__veylinTest!.panelState());
    expect(state.activeId).toBe(split?.bottomVisibleId);

    await page.evaluate(() => window.__veylinTest!.moveTabToPane('rag', 'top'));
    await expect(page.locator('[role="separator"][aria-orientation="horizontal"]')).toHaveCount(0);
    const after = await page.evaluate(() => window.__veylinTest!.panelState());
    expect(after.split).toBeUndefined();
    expect(after.tabs).toHaveLength(2);
  });

  test('activating a top tab leaves the bottom pane untouched', async ({ page }) => {
    await openTwoAndSplit(page);
    // 上 pane 可见 web、下 pane 可见 rag —— 点上 pane 的页签不该动下 pane。
    await expect(page.locator('[data-panel-kind="rag"]')).toBeVisible();
    await page.locator('.panel-tab-label').first().click();
    await expect(page.locator('[data-panel-kind="web"]')).toBeVisible();
    await expect(page.locator('[data-panel-kind="rag"]')).toBeVisible();
  });

  test('splitter drag persists the ratio', async ({ page }) => {
    await openTwoAndSplit(page);
    const sep = page.locator('[role="separator"][aria-orientation="horizontal"]');
    await expect(sep).toBeVisible();
    const before = await sep.boundingBox();
    // 真指针拖动(playwright 的 mouse 是可信指针,不踩 setPointerCapture 合成坑)。
    await page.mouse.move(before!.x + 40, before!.y + 1);
    await page.mouse.down();
    await page.mouse.move(before!.x + 40, before!.y - 120, { steps: 4 });
    await page.mouse.up();
    const after = await sep.boundingBox();
    expect(after!.y).toBeLessThan(before!.y - 60);
    const ratio = await page.evaluate(() => window.__veylinTest!.panelState().split?.ratio);
    expect(ratio).toBeLessThan(0.5);
  });

  test('closing the last bottom tab dissolves the split', async ({ page }) => {
    await openTwoAndSplit(page);
    await expect(page.locator('[role="separator"]')).toBeVisible();
    // 下 pane 唯一页签的关闭钮(第二条页签栏)。
    await page.locator('button.panel-tab-close').last().click();
    await expect(page.locator('[role="separator"]')).toHaveCount(0);
    const state = await page.evaluate(() => window.__veylinTest!.panelState());
    expect(state.split).toBeUndefined();
    expect(state.tabs.map((t) => t.kind)).toEqual(['web']);
  });
});
