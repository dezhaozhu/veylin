export type VeylinHealthPayload = {
  ok?: boolean;
  db?: { ready?: boolean };
};

export function isVeylinHealthReady(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const body = payload as VeylinHealthPayload;
  return body.ok === true && body.db?.ready === true;
}

export async function probeVeylinHealth(
  url: string,
  options?: { signal?: AbortSignal },
): Promise<boolean> {
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      signal: options?.signal,
    });
    if (!res.ok) return false;
    const payload = (await res.json()) as unknown;
    return isVeylinHealthReady(payload);
  } catch {
    return false;
  }
}
