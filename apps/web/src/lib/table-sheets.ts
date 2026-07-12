import i18n from '@/i18n';

export interface TableSheetMeta {
  id: string;
  name: string;
  builtin: boolean;
}

async function readJsonResponse<T>(res: Response): Promise<T> {
  const data = (await res.json()) as T;
  if (!res.ok) {
    throw new Error((data as { message?: string }).message ?? `HTTP ${res.status}`);
  }
  return data;
}

export async function fetchThreadSheets(
  threadId?: string | null,
): Promise<TableSheetMeta[]> {
  if (!threadId?.trim()) return [];
  const res = await fetch(
    `/api/table/sheets?threadId=${encodeURIComponent(threadId.trim())}`,
  );
  const data = await readJsonResponse<{ ok?: boolean; sheets?: TableSheetMeta[] }>(
    res,
  );
  if (!data.sheets) {
    throw new Error((data as { message?: string }).message ?? `HTTP ${res.status}`);
  }
  return data.sheets;
}

/** Next unused "Sheet N" within this thread. */
export async function nextSequentialSheetName(
  threadId: string | null | undefined,
  localSheets: TableSheetMeta[] = [],
): Promise<string> {
  let used = new Set(localSheets.map((s) => s.name.trim().toLowerCase()));
  if (threadId?.trim()) {
    try {
      const all = await fetchThreadSheets(threadId);
      used = new Set(all.map((s) => s.name.trim().toLowerCase()));
    } catch {
      // Fall back to local names only.
    }
  }
  let n = 1;
  while (used.has(`sheet ${n}`)) n += 1;
  return `Sheet ${n}`;
}

export async function createThreadSheet(
  threadId: string,
  name: string,
): Promise<TableSheetMeta> {
  const res = await fetch('/api/table/sheets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, threadId }),
  });
  const data = (await res.json()) as {
    ok?: boolean;
    message?: string;
    sheet?: TableSheetMeta;
  };
  if (res.status === 409) {
    const err = new Error('name_conflict') as Error & { status: number };
    err.status = 409;
    throw err;
  }
  if (!res.ok || !data.ok || !data.sheet) {
    throw new Error(data.message ?? i18n.t('table.createSheetFailed'));
  }
  return data.sheet;
}

function isNameConflict(err: unknown): boolean {
  return (
    (err as { status?: number })?.status === 409 ||
    (err instanceof Error && err.message === 'name_conflict')
  );
}

/** Create the next sequential sheet for a thread (user-initiated). */
export async function createNextThreadSheet(
  threadId: string,
): Promise<TableSheetMeta> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const name = await nextSequentialSheetName(threadId);
    try {
      return await createThreadSheet(threadId, name);
    } catch (err) {
      if (isNameConflict(err)) continue;
      throw err;
    }
  }
  throw new Error(i18n.t('table.createSheetFailed'));
}
