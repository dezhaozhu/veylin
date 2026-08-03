import { expect, test } from '@playwright/test';

const API = process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:8787';

test.describe('Chat smoke', () => {
  test('home loads and thread becomes ready', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () =>
        document.body.innerText.includes('问点什么') ||
        document.body.innerText.includes('发送消息') ||
        document.body.innerText.includes('Send'),
    );
    await page.waitForFunction(() => window.__veylinTest?.hasThread?.(), undefined, {
      timeout: 30_000,
    });
    await expect(page.locator('text=Reconnecting').first()).toHaveCount(0);
  });

  test('health endpoint is reachable', async ({ request }) => {
    const res = await request.get(`${API}/health`);
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { ok?: boolean };
    expect(body.ok).toBe(true);
  });
});

declare global {
  interface Window {
    __veylinTest?: { hasThread: () => boolean };
  }
}
