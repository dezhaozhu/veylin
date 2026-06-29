/** @param {unknown} payload */
export function isVeylinHealthReady(payload) {
  if (!payload || typeof payload !== 'object') return false;
  return payload.ok === true && payload.db?.ready === true;
}

/**
 * @param {string} url
 * @param {{ signal?: AbortSignal }} [options]
 */
export async function probeVeylinHealth(url, options = {}) {
  try {
    const res = await fetch(url, { cache: 'no-store', signal: options.signal });
    if (!res.ok) return false;
    const payload = await res.json();
    return isVeylinHealthReady(payload);
  } catch {
    return false;
  }
}
