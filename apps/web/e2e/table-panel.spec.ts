import { expect, test } from '@playwright/test';

const API = process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:8787';

test.describe('Table panel API', () => {
  test('import rows with custom column names', async ({ request }) => {
    const threadId = `e2e-thread-${Date.now()}`;
    const sheet = `e2e-${Date.now()}`;
    const createRes = await request.post(`${API}/api/table/sheets`, {
      data: { name: sheet, threadId },
    });
    expect(createRes.ok()).toBeTruthy();
    const created = (await createRes.json()) as { sheet?: { id: string } };
    const sheetId = created.sheet?.id ?? sheet;

    const res = await request.post(`${API}/api/table/import`, {
      data: {
        sheet: sheetId,
        threadId,
        column_names: ['col_a', 'col_b'],
        rows: [{ col_a: '1', col_b: '2' }],
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { ok?: boolean; columns?: { key: string }[] };
    expect(body.ok).toBe(true);
    expect(body.columns?.some((c) => c.key === 'col_a')).toBe(true);
  });
});
