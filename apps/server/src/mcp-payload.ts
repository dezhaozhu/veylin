/**
 * Unwrap a remote Mastra MCP tool result. Depending on the Mastra version + MCP
 * transport it is either the typed object directly, or wrapped in content[0].text
 * as a JSON string. Returns the parsed payload object (or {} on failure).
 */
export function unwrapMcpPayload(res: unknown): Record<string, unknown> {
  // Already the typed payload: any direct object that is NOT a content/text
  // transport wrapper — e.g. {columns,rows,…} or {resources:[…]}.
  if (
    res != null &&
    typeof res === 'object' &&
    !Array.isArray(res) &&
    !('content' in (res as object)) &&
    !('text' in (res as object))
  ) {
    return res as Record<string, unknown>;
  }
  try {
    const r = res as Record<string, unknown> | null;
    const text =
      (r?.['content'] as Array<Record<string, unknown>> | undefined)?.[0]?.['text'] ??
      r?.['text'] ??
      '{}';
    return JSON.parse(String(text)) as Record<string, unknown>;
  } catch {
    return {};
  }
}
