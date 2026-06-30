import { expect, test } from '@playwright/test';

const API = process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:8787';

test.describe('Skills settings API', () => {
  test('lists skills for default agent', async ({ request }) => {
    const res = await request.get(`${API}/api/skills`);
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { skills?: unknown[]; disabledSkills?: unknown[] };
    expect(Array.isArray(body.skills)).toBe(true);
    expect(Array.isArray(body.disabledSkills)).toBe(true);
  });
});
