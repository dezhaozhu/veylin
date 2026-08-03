/** Serialize event trigger `on` field for SurrealDB storage. */
export function serializeEventOn(value: string | string[] | null | undefined): string | null {
  if (value == null) return null;
  if (Array.isArray(value)) return JSON.stringify(value);
  return value;
}

/** Parse event trigger `on` field from SurrealDB. */
export function parseEventOn(raw: unknown): string | string[] | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) return parsed.map(String);
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }
  if (Array.isArray(raw)) return raw.map(String);
  return null;
}
