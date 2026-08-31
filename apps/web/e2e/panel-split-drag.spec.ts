import { expect, test, type Page } from '@playwright/test';

/**
 * 拖页签分屏。**全部用真指针**(page.mouse):这套交互的价值就在手感,
 * 合成事件测不出 —— setPointerCapture 那个坑就是合成事件测不出来的
 * (见 right-panel.tsx 的 try/catch 注释)。
 */

type DevPanelState = {
  tabs: Array<{ id: string; kind: string }>;
  activeId: string | null;
  split?: { bottomIds: string[]; ratio: number } | undefined;
};

declare global {
  interface Window {
    __veylinTest?: {
      openPanel: (kind: string) => void;
      panelState: () => DevPanelState;
    };
  }
}

const GHOST = '[data-testid="panel-drag-ghost"]';
const PREVIEW = '[data-testid="panel-drop-preview"]';

async function openTwo(page: Page): Promise<void> {
  await page.evaluate(() => window.__veylinTest!.openPanel('web'));
  await page.evaluate(() => window.__veylinTest!.openPanel('rag'));
  await page.waitForFunction(() => window.__veylinTest!.panelState().tabs.length === 2);
}

/**
 * 按住某个页签开始拖,把指针停在 (x, y);不松手。
 *
 * **先 hover 再按**:右栏打开是带动画的,openPanel 之后页签还在滑。直接
 * boundingBox 会量到动画中途的位置,等按下去时它已经挪走了 —— 指针落在页签栏
 * 空白处,拖拽根本不启动(实测整组假红)。hover 自带 Playwright 的稳定性检查
 * (连续两帧盒子不变),等它过了再量才是页签的最终位置。
 */
async function grabTab(page: Page, label: string, x: number, y: number): Promise<void> {
  const tab = page.locator(`.panel-tab-label:has-text("${label}")`);
  await tab.hover();
  const box = await tab.boundingBox();
  if (!box) throw new Error(`tab not found: ${label}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 8 });
}

test.describe('Right-panel tab drag', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
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

  test('拖到下半 → 预览下半块 → 松手建分屏', async ({ page }) => {
    await openTwo(page);
    const size = page.viewportSize()!;
    await grabTab(page, 'Knowledge', size.width - 200, size.height - 150);

    await expect(page.locator(GHOST)).toBeVisible();
    const preview = page.locator(PREVIEW);
    await expect(preview).toBeVisible();
    // 预览是右栏的下半块 —— 上边缘应落在视口中线附近。
    const band = (await preview.boundingBox())!;
    expect(Math.abs(band.y - size.height / 2)).toBeLessThan(24);

    await page.mouse.up();
    await expect(page.locator('[role="separator"][aria-orientation="horizontal"]')).toBeVisible();
    await expect(page.locator(GHOST)).toHaveCount(0);
    await expect(page.locator(PREVIEW)).toHaveCount(0);
    const split = await page.evaluate(() => window.__veylinTest!.panelState().split);
    expect(split?.bottomIds).toHaveLength(1);
  });

  test('拖回原来那个 pane 不给落点 —— 不会有变化就不亮预览', async ({ page }) => {
    await openTwo(page);
    const size = page.viewportSize()!;
    // 未分屏时上半 = 原地。
    await grabTab(page, 'Knowledge', size.width - 200, 200);
    await expect(page.locator(GHOST)).toBeVisible();
    await expect(page.locator(PREVIEW)).toHaveCount(0);
    await page.mouse.up();
    await expect(page.locator('[role="separator"]')).toHaveCount(0);
  });

  test('Esc 取消:浮影预览都收掉,松手也不补交', async ({ page }) => {
    await openTwo(page);
    const size = page.viewportSize()!;
    await grabTab(page, 'Knowledge', size.width - 200, size.height - 150);
    await expect(page.locator(PREVIEW)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator(GHOST)).toHaveCount(0);
    await expect(page.locator(PREVIEW)).toHaveCount(0);
    await page.mouse.up();
    await expect(page.locator('[role="separator"]')).toHaveCount(0);
    // 拖动期间给 body 加的样式必须收干净,否则整个应用没法选文字。
    const body = await page.evaluate(() => ({
      cursor: document.body.style.cursor,
      userSelect: document.body.style.userSelect,
    }));
    expect(body).toEqual({ cursor: '', userSelect: '' });
  });

  test('点一下仍然是切换页签,不是微型拖拽', async ({ page }) => {
    await openTwo(page);
    await page.locator('.panel-tab-label:has-text("Web")').click();
    await expect(page.locator(GHOST)).toHaveCount(0);
    const state = await page.evaluate(() => window.__veylinTest!.panelState());
    const web = state.tabs.find((tb) => tb.kind === 'web');
    expect(state.activeId).toBe(web?.id);
  });

  test('上 pane 只剩一个页签:可以拖但没有落点(不许掏空上 pane)', async ({ page }) => {
    await page.evaluate(() => window.__veylinTest!.openPanel('web'));
    await page.waitForFunction(() => window.__veylinTest!.panelState().tabs.length === 1);
    const size = page.viewportSize()!;
    await grabTab(page, 'Web', size.width - 200, size.height - 150);
    await expect(page.locator(PREVIEW)).toHaveCount(0);
    await page.mouse.up();
    await expect(page.locator('[role="separator"]')).toHaveCount(0);
  });

  test('分隔线双击回正', async ({ page }) => {
    await openTwo(page);
    const size = page.viewportSize()!;
    await grabTab(page, 'Knowledge', size.width - 200, size.height - 150);
    await page.mouse.up();
    const sep = page.locator('[role="separator"][aria-orientation="horizontal"]');
    await expect(sep).toBeVisible();

    const box = (await sep.boundingBox())!;
    await page.mouse.move(box.x + 40, box.y + 1);
    await page.mouse.down();
    await page.mouse.move(box.x + 40, box.y - 250, { steps: 5 });
    await page.mouse.up();
    await expect
      .poll(() => page.evaluate(() => window.__veylinTest!.panelState().split?.ratio))
      .toBeLessThan(0.45);

    const skewed = (await sep.boundingBox())!;
    await page.mouse.dblclick(skewed.x + 40, skewed.y + 1);
    await expect
      .poll(() => page.evaluate(() => window.__veylinTest!.panelState().split?.ratio))
      .toBe(0.5);
  });
});
