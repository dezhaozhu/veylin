import { expect, test } from '@playwright/test';

const API = process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:8787';

test.describe('Model settings API', () => {
  test('GET model-settings returns shape', async ({ request }) => {
    const res = await request.get(`${API}/api/model-settings`);
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { settings?: { modelName?: string; hasApiKey?: boolean } };
    expect(body.settings).toBeTruthy();
    expect(typeof body.settings?.modelName).toBe('string');
  });

  test('PUT model-settings accepts OpenAI-compatible config', async ({ request }) => {
    const res = await request.put(`${API}/api/model-settings`, {
      data: {
        modelName: 'e2e-test-model',
        requestUrl: 'https://api.example.com/v1',
        apiKey: 'sk-e2e-test-key',
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { settings?: { configured?: boolean; hasApiKey?: boolean } };
    expect(body.settings?.hasApiKey).toBe(true);
    expect(body.settings?.configured).toBe(true);
  });
});
