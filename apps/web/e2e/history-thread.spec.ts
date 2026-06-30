import { expect, test } from '@playwright/test';

const API = process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:8787';

test.describe('History threads', () => {
  test('thread list API returns without error', async ({ request }) => {
    const res = await request.get(`${API}/api/threads`);
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { threads?: unknown[] };
    expect(Array.isArray(body.threads)).toBe(true);
  });

  test('opening home does not throw maximum update depth', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/');
    await page.waitForTimeout(2000);
    const depthErrors = errors.filter((m) => m.includes('Maximum update depth'));
    expect(depthErrors).toHaveLength(0);
  });
});
