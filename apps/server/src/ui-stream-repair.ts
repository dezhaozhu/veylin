/** UI message stream chunks from Mastra may omit reasoning-start on later agent steps. */
export type UiStreamChunk = {
  type?: string;
  id?: string;
  [key: string]: unknown;
};

export function createUiStreamRepairState(): {
  openReasoningIds: Set<string>;
} {
  return { openReasoningIds: new Set<string>() };
}

/**
 * AI SDK v6 requires reasoning-start before reasoning-delta/end per part id.
 * Mastra reuses ids such as "reasoning-0" across tool-loop steps after reasoning-end.
 */
export function repairUiStreamChunk(
  chunk: UiStreamChunk,
  state: { openReasoningIds: Set<string> },
): UiStreamChunk[] {
  const type = chunk.type;
  const id = typeof chunk.id === 'string' ? chunk.id : undefined;

  if (type === 'step-start') {
    state.openReasoningIds.clear();
    return [chunk];
  }

  if (type === 'reasoning-start' && id) {
    state.openReasoningIds.add(id);
    return [chunk];
  }

  if ((type === 'reasoning-delta' || type === 'reasoning-end') && id) {
    if (!state.openReasoningIds.has(id)) {
      state.openReasoningIds.add(id);
      return [{ type: 'reasoning-start', id }, chunk];
    }
    if (type === 'reasoning-end') {
      state.openReasoningIds.delete(id);
    }
    return [chunk];
  }

  return [chunk];
}

export function formatAgentStreamError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/other side closed|ECONNRESET|socket hang up|connection reset/i.test(message)) {
    return '模型 API 连接中断，请稍后重试。';
  }
  if (/AI_APICallError/i.test(message)) {
    return '模型 API 调用失败，请稍后重试。';
  }
  return message.length > 240 ? `${message.slice(0, 240)}…` : message;
}
