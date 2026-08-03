import { expect, test } from '@playwright/test';

const API = process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:8787';

test.describe('Plan mode API', () => {
  test('plan-mode round-trip for a thread', async ({ request }) => {
    const threadId = `e2e-plan-${Date.now()}`;
    const on = await request.post(`${API}/api/plan-mode`, {
      data: { threadId, planMode: true },
    });
    expect(on.ok()).toBeTruthy();
    const onBody = (await on.json()) as { planMode?: boolean };
    expect(onBody.planMode).toBe(true);

    const get = await request.get(`${API}/api/plan-mode?threadId=${encodeURIComponent(threadId)}`);
    expect(get.ok()).toBeTruthy();
    const getBody = (await get.json()) as { planMode?: boolean };
    expect(getBody.planMode).toBe(true);

    await request.post(`${API}/api/plan-mode`, {
      data: { threadId, planMode: false },
    });
    const off = await request.get(`${API}/api/plan-mode?threadId=${encodeURIComponent(threadId)}`);
    const offBody = (await off.json()) as { planMode?: boolean };
    expect(offBody.planMode).toBe(false);
  });
});
