export type MessageSentAtCustom = {
  sentAt?: number;
  interrupted?: boolean;
};

export function extractSentAtFromParts(parts: unknown[] | undefined): number | undefined {
  if (!parts) return undefined;
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    const ts = (part as { createdAt?: number }).createdAt;
    if (typeof ts === 'number' && Number.isFinite(ts)) return ts;
  }
  return undefined;
}

export function getMessageSentAt(message: {
  metadata?: unknown;
  parts?: unknown[];
}): number | undefined {
  const custom = (message.metadata as { custom?: MessageSentAtCustom } | undefined)?.custom;
  if (typeof custom?.sentAt === 'number' && Number.isFinite(custom.sentAt)) {
    return custom.sentAt;
  }
  return extractSentAtFromParts(message.parts as unknown[] | undefined);
}

export function stampMessageWithSentAt<T extends { metadata?: unknown }>(
  message: T,
  sentAt: number = Date.now(),
): T {
  const metadata = (message.metadata ?? {}) as Record<string, unknown>;
  const custom = (metadata.custom ?? {}) as MessageSentAtCustom;
  return {
    ...message,
    metadata: {
      ...metadata,
      custom: {
        ...custom,
        sentAt,
      },
    },
  };
}

/** Mark an assistant turn as user-interrupted; preserve existing sentAt when present. */
export function stampInterruptedAssistant<T extends { metadata?: unknown }>(
  message: T,
  sentAt: number = Date.now(),
): T {
  const metadata = (message.metadata ?? {}) as Record<string, unknown>;
  const custom = (metadata.custom ?? {}) as MessageSentAtCustom;
  return {
    ...message,
    metadata: {
      ...metadata,
      custom: {
        ...custom,
        sentAt: typeof custom.sentAt === 'number' ? custom.sentAt : sentAt,
        interrupted: true,
      },
    },
  };
}

/** Locale-aware short date + time, e.g. "May 13, 20:30" or "5月13日 20:30". */
export function formatMessageTime(sentAt: number): string {
  const date = new Date(sentAt);
  let lang = 'en';
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem('veylin-lang');
    if (stored) lang = stored;
  } else if (typeof navigator !== 'undefined') {
    lang = navigator.language;
  }
  const datePart = date.toLocaleDateString(lang, { month: 'short', day: 'numeric' });
  const timePart = date.toLocaleTimeString(lang, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${datePart} ${timePart}`;
}
