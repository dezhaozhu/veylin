/** SurrealKV / Mastra memory corruption or transient store failures. */
export function isDatastoreFailure(err: unknown): boolean {
  const parts: string[] = [];
  if (err instanceof Error) {
    parts.push(err.name, err.message);
    const nested = (err as { message?: unknown }).message;
    if (nested != null && typeof nested === 'object') {
      parts.push(JSON.stringify(nested));
    }
  } else {
    parts.push(String(err));
  }
  const text = parts.join(' ');
  return /GenericFailure|Invalid revision/i.test(text);
}

export async function withDatastoreFallback<T>(
  run: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (isDatastoreFailure(err)) return fallback;
    throw err;
  }
}
