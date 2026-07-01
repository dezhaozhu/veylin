import { expect, test } from '@playwright/test';

const API = process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:8787';

test.describe('Workflow panel API', () => {
  test('lists workflows', async ({ request }) => {
    const res = await request.get(`${API}/api/workflows`);
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { workflows?: unknown[] };
    expect(Array.isArray(body.workflows)).toBe(true);
  });
});
