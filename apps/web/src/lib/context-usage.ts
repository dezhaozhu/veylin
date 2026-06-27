import type { ModelKey } from '@/lib/chat-settings';

/**
 * Context-window usage helpers: estimate token counts and the percentage of a
 * model's context window consumed by the current conversation, used to drive
 * the composer status line and automatic compaction.
 */

const DEFAULT_CONTEXT_WINDOW = 1_000_000;

export function getModelContextWindow(_model: ModelKey): number {
  return DEFAULT_CONTEXT_WINDOW;
}

/** char/4 heuristic for a rough token-count estimate when usage is unavailable. */
export function roughTokenCountEstimation(content: string, bytesPerToken = 4): number {
  if (!content) return 0;
  return Math.round(content.length / bytesPerToken);
}

export type ApiUsageLike = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

export function getTokenCountFromUsage(usage: ApiUsageLike): number {
  return (
    usage.input_tokens +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) +
    usage.output_tokens
  );
}

/**
 * Status-line style percentages — input + cache only, full window denominator.
 */
export function calculateContextPercentages(
  currentUsage: Pick<
    ApiUsageLike,
    'input_tokens' | 'cache_creation_input_tokens' | 'cache_read_input_tokens'
  > | null,
  contextWindowSize: number,
): { used: number | null; remaining: number | null } {
  if (!currentUsage || contextWindowSize <= 0) {
    return { used: null, remaining: null };
  }

  const totalInputTokens =
    currentUsage.input_tokens +
    (currentUsage.cache_creation_input_tokens ?? 0) +
    (currentUsage.cache_read_input_tokens ?? 0);

  const usedPercentage = Math.round((totalInputTokens / contextWindowSize) * 100);
  const clampedUsed = Math.min(100, Math.max(0, usedPercentage));

  return {
    used: clampedUsed,
    remaining: 100 - clampedUsed,
  };
}

function partToRoughText(part: unknown): string {
  if (!part || typeof part !== 'object') return '';
  const p = part as {
    type?: string;
    text?: string;
    toolName?: string;
    name?: string;
    args?: unknown;
    argsText?: string;
    input?: unknown;
    result?: unknown;
    output?: unknown;
    data?: unknown;
  };

  switch (p.type) {
    case 'text':
    case 'reasoning':
      return typeof p.text === 'string' ? p.text : '';
    case 'tool-call': {
      const toolName = p.toolName ?? p.name ?? '';
      const args =
        typeof p.argsText === 'string'
          ? p.argsText
          : p.args != null
            ? JSON.stringify(p.args)
            : p.input != null
              ? JSON.stringify(p.input)
              : '';
      return [toolName, args].filter(Boolean).join(' ');
    }
    case 'tool-result': {
      const content = p.result ?? p.output ?? p.text;
      if (typeof content === 'string') return content;
      if (content != null) return JSON.stringify(content);
      return '';
    }
    case 'thinking':
      return typeof p.text === 'string' ? p.text : '';
    case 'redacted_thinking':
      return typeof p.data === 'string' ? p.data : '';
    case 'image':
    case 'document':
      return ' '.repeat(2000);
    default:
      if (typeof p.type === 'string' && p.type.startsWith('tool-')) {
        const toolName = p.type.slice('tool-'.length);
        const args = p.input != null ? JSON.stringify(p.input) : '';
        const output = p.output != null ? JSON.stringify(p.output) : '';
        return [toolName, args, output].filter(Boolean).join(' ');
      }
      if (typeof p.text === 'string') return p.text;
      return JSON.stringify(p);
  }
}

function getMessageParts(message: unknown): unknown[] {
  if (!message || typeof message !== 'object') return [];
  const m = message as {
    content?: unknown;
    parts?: unknown[];
    message?: { content?: unknown; parts?: unknown[] };
  };

  if (Array.isArray(m.parts)) return m.parts;
  if (Array.isArray(m.content)) return m.content;
  if (typeof m.content === 'string' && m.content.length > 0) {
    return [{ type: 'text', text: m.content }];
  }

  const inner = m.message;
  if (inner) {
    if (Array.isArray(inner.parts)) return inner.parts;
    if (Array.isArray(inner.content)) return inner.content;
    if (typeof inner.content === 'string' && inner.content.length > 0) {
      return [{ type: 'text', text: inner.content }];
    }
  }

  return [];
}

function roughTokenCountForMessage(message: unknown): number {
  const parts = getMessageParts(message);
  if (parts.length === 0) return 0;
  let total = 0;
  for (const part of parts) {
    total += roughTokenCountEstimation(partToRoughText(part));
  }
  return total;
}

function roughTokenCountEstimationForMessages(messages: readonly unknown[]): number {
  let total = 0;
  for (const message of messages) {
    total += roughTokenCountForMessage(message);
  }
  return total;
}

function parseUsageObject(raw: unknown): ApiUsageLike | null {
  if (!raw || typeof raw !== 'object') return null;
  const u = raw as Record<string, unknown>;
  const input =
    typeof u.input_tokens === 'number'
      ? u.input_tokens
      : typeof u.inputTokens === 'number'
        ? u.inputTokens
        : null;
  const output =
    typeof u.output_tokens === 'number'
      ? u.output_tokens
      : typeof u.outputTokens === 'number'
        ? u.outputTokens
        : null;
  if (input == null || output == null) return null;
  return {
    input_tokens: input,
    output_tokens: output,
    cache_creation_input_tokens:
      typeof u.cache_creation_input_tokens === 'number'
        ? u.cache_creation_input_tokens
        : typeof u.cacheCreationInputTokens === 'number'
          ? u.cacheCreationInputTokens
          : 0,
    cache_read_input_tokens:
      typeof u.cache_read_input_tokens === 'number'
        ? u.cache_read_input_tokens
        : typeof u.cacheReadInputTokens === 'number'
          ? u.cacheReadInputTokens
          : 0,
  };
}

function getTokenUsageFromMessage(message: unknown): ApiUsageLike | null {
  if (!message || typeof message !== 'object') return null;
  const m = message as {
    metadata?: unknown;
    message?: { usage?: unknown };
  };

  const candidates = [
    m.message?.usage,
    (m.metadata as { usage?: unknown } | undefined)?.usage,
    (m.metadata as { custom?: { usage?: unknown } } | undefined)?.custom?.usage,
  ];

  for (const raw of candidates) {
    const parsed = parseUsageObject(raw);
    if (parsed) return parsed;
  }

  for (const part of getMessageParts(message)) {
    if (!part || typeof part !== 'object') continue;
    const p = part as { type?: string; data?: unknown };
    if (p.type !== 'data' || !p.data || typeof p.data !== 'object') continue;
    const data = p.data as { usage?: unknown; veylin_context_usage?: unknown };
    const parsed = parseUsageObject(data.usage ?? data.veylin_context_usage);
    if (parsed) return parsed;
  }

  return null;
}

function getAssistantMessageId(message: unknown): string | undefined {
  if (!message || typeof message !== 'object') return undefined;
  const m = message as { id?: string; message?: { id?: string } };
  return m.message?.id ?? m.id;
}

/**
 * Canonical context size — last API usage + rough estimate for newer messages.
 */
export function tokenCountWithEstimation(
  messages: readonly unknown[],
  composerText = '',
): number {
  let anchor = messages.length - 1;
  while (anchor >= 0) {
    const message = messages[anchor];
    const usage = message ? getTokenUsageFromMessage(message) : null;
    if (message && usage) {
      const responseId = getAssistantMessageId(message);
      if (responseId) {
        let j = anchor - 1;
        while (j >= 0) {
          const prior = messages[j];
          const priorId = prior ? getAssistantMessageId(prior) : undefined;
          if (priorId === responseId) {
            anchor = j;
          } else if (priorId !== undefined) {
            break;
          }
          j--;
        }
      }

      const tail = messages.slice(anchor + 1);
      const draftMessages =
        composerText.trim().length > 0
          ? [{ role: 'user', content: composerText }]
          : [];
      return (
        getTokenCountFromUsage(usage) +
        roughTokenCountEstimationForMessages([...tail, ...draftMessages])
      );
    }
    anchor--;
  }

  const allMessages =
    composerText.trim().length > 0
      ? [...messages, { role: 'user', content: composerText }]
      : messages;
  return roughTokenCountEstimationForMessages(allMessages);
}

export type ContextUsageSnapshot = {
  estimatedTokens: number;
  contextWindow: number;
  usedPercent: number;
  freePercent: number;
};

/** Composer ring + tooltip values for the active model. */
export function computeContextUsage(opts: {
  messages: readonly unknown[];
  composerText: string;
  model: ModelKey;
}): ContextUsageSnapshot {
  const contextWindow = getModelContextWindow(opts.model);
  const estimatedTokens = tokenCountWithEstimation(opts.messages, opts.composerText);

  let lastUsage: ApiUsageLike | null = null;
  for (let i = opts.messages.length - 1; i >= 0; i--) {
    const usage = getTokenUsageFromMessage(opts.messages[i]);
    if (usage) {
      lastUsage = usage;
      break;
    }
  }

  return computeContextUsageSnapshot(estimatedTokens, opts.model, lastUsage);
}

export function getLastTokenUsageFromMessages(
  messages: readonly unknown[],
): ApiUsageLike | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const usage = getTokenUsageFromMessage(messages[i]);
    if (usage) return usage;
  }
  return null;
}

export function computeContextUsageSnapshot(
  estimatedTokens: number,
  model: ModelKey,
  lastUsage: ApiUsageLike | null,
): ContextUsageSnapshot {
  const contextWindow = getModelContextWindow(model);
  const fromApi = calculateContextPercentages(lastUsage, contextWindow);
  if (fromApi.used != null && fromApi.remaining != null) {
    return {
      estimatedTokens,
      contextWindow,
      usedPercent: fromApi.used,
      freePercent: fromApi.remaining,
    };
  }

  const rawPercent = (estimatedTokens / contextWindow) * 100;
  const usedPercent =
    estimatedTokens <= 0
      ? 0
      : Math.min(100, Math.max(1, Math.ceil(rawPercent * 10) / 10));

  return {
    estimatedTokens,
    contextWindow,
    usedPercent,
    freePercent: 100 - usedPercent,
  };
}

/** Stable primitive for useAuiState — returns estimated token count only. */
export function measureContextTokenCount(
  messages: readonly unknown[],
  composerText: string,
): number {
  return tokenCountWithEstimation(messages, composerText);
}

export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}
