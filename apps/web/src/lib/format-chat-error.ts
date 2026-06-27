import i18n from '@/i18n';

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error ?? '');
}

function ce(key: string, opts?: Record<string, unknown>): string {
  return i18n.t(`chatError.${key}`, opts);
}

function parseHttpChatError(raw: string): FormattedChatError | null {
  const match = raw.match(/^(?:chat|resume|stream_resume)_http_(\d+)(?::([\s\S]+))?$/);
  if (!match) return null;

  const status = Number(match[1]);
  const serverDetail = match[2]?.trim();

  if (serverDetail && /model_not_configured|Model API key is not configured/i.test(serverDetail)) {
    return { title: ce('modelNotConfigured.title'), detail: ce('modelNotConfigured.detail') };
  }

  const byStatus: Record<number, { title: string; detail: string }> = {
    429: { title: ce('rateLimited.title'), detail: ce('rateLimited.detail') },
    500: { title: ce('serverError.title'), detail: ce('serverError.detail') },
    502: {
      title: ce('backendUnavailable.title'),
      detail: ce('backendUnavailable.detail', { status: 502 }),
    },
    503: {
      title: ce('backendUnavailable.title'),
      detail: ce('backendUnavailable.detail', { status: 503 }),
    },
    504: { title: ce('gatewayTimeout.title'), detail: ce('gatewayTimeout.detail') },
  };

  const mapped = byStatus[status];
  if (mapped) {
    return {
      title: mapped.title,
      detail: serverDetail && !serverDetail.startsWith('chat_http_') ? serverDetail : mapped.detail,
    };
  }

  return {
    title: ce('requestFailed.title'),
    detail:
      serverDetail && !serverDetail.startsWith('chat_http_')
        ? serverDetail
        : ce('requestFailedHttp', { status }),
  };
}

/** Errors that should not surface in the UI (normal resume no-op, user cancel). */
export function isBenignChatError(error: unknown): boolean {
  const message = errorMessage(error);
  return (
    /nothing to resume|no resumable stream id available/i.test(message) ||
    /Aborted|aborted/i.test(message)
  );
}

export type FormattedChatError = {
  title: string;
  detail: string;
};

/** Map transport / network errors to user-facing copy (hide library internals). */
export function formatChatError(error: unknown): FormattedChatError | null {
  if (isBenignChatError(error)) return null;

  const raw = errorMessage(error)
    .replace(/^AssistantChatTransport:\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim();

  const httpChat = parseHttpChatError(raw);
  if (httpChat) return httpChat;

  if (/stopped by user/i.test(raw)) {
    return { title: ce('stopped.title'), detail: ce('stopped.detail') };
  }
  if (/liveness_timeout|stream_idle/i.test(raw)) {
    return { title: ce('livenessTimeout.title'), detail: ce('livenessTimeout.detail') };
  }
  if (/reconnect time budget/i.test(raw)) {
    return { title: ce('reconnectFailed.title'), detail: ce('reconnectFailed.detail') };
  }
  if (/fetch failed|network|ECONNREFUSED|ETIMEDOUT|Failed to fetch/i.test(raw)) {
    return { title: ce('network.title'), detail: ce('network.detail') };
  }
  if (/502|503|504/i.test(raw)) {
    return { title: ce('busyRetry.title'), detail: ce('busyRetry.detail') };
  }
  if (/401|403|unauthorized/i.test(raw)) {
    return { title: ce('unauthorized.title'), detail: ce('unauthorized.detail') };
  }
  if (/model_not_configured|Model API key is not configured/i.test(raw)) {
    return { title: ce('modelNotConfigured.title'), detail: ce('modelNotConfigured.detail') };
  }

  if (!raw) {
    return { title: ce('requestFailed.title'), detail: ce('unknown.detail') };
  }

  // Hide internal transport codes if they slip through.
  if (/^(?:chat|resume|stream_resume)_http_\d+/.test(raw)) {
    return (
      parseHttpChatError(raw.split(':')[0]!) ?? {
        title: ce('requestFailed.title'),
        detail: ce('retryLater'),
      }
    );
  }

  return {
    title: ce('connectFailed.title'),
    detail: raw.length > 120 ? `${raw.slice(0, 120)}…` : raw,
  };
}
