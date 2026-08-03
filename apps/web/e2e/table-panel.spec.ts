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

    const getRes = await request.get(
      `${API}/api/table?sheet=${encodeURIComponent(sheetId)}&threadId=${encodeURIComponent(threadId)}`,
    );
    expect(getRes.ok()).toBeTruthy();
    const table = (await getRes.json()) as { rows?: Array<{ row_id: string; col_a?: string }> };
    const rowId = table.rows?.[0]?.row_id;
    expect(rowId).toBeTruthy();

    const patchRes = await request.patch(`${API}/api/table/rows`, {
      data: {
        sheet: sheetId,
        threadId,
        rows: [{ row_key: rowId, col_a: 'updated' }],
      },
    });
    expect(patchRes.ok()).toBeTruthy();
    const patched = (await patchRes.json()) as { ok?: boolean; rows?: Array<{ col_a?: string }> };
    expect(patched.ok).toBe(true);
    expect(patched.rows?.[0]?.col_a).toBe('updated');
  });
});
