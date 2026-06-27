import { useAuiState } from '@assistant-ui/react';
import { useTranslation } from 'react-i18next';
import { POST_MAX_RETRIES } from '@/lib/transport-reconnect';
import {
  useNetworkReconnectStore,
  type NetworkBannerKind,
} from '@/lib/network-reconnect-store';

function isInlineReconnectKind(kind: NetworkBannerKind): boolean {
  return (
    kind === 'reconnecting' ||
    kind === 'post_retrying' ||
    kind === 'offline' ||
    kind === 'connection_error'
  );
}

function NetworkReconnectStatus() {
  const { t } = useTranslation();
  const kind = useNetworkReconnectStore((s) => s.kind);
  const attempt = useNetworkReconnectStore((s) => s.reconnectAttempt);
  const title = useNetworkReconnectStore((s) => s.title);
  const message = useNetworkReconnectStore((s) => s.message);

  if (!kind || !isInlineReconnectKind(kind)) return null;

  let line = title ?? '';
  if (kind === 'reconnecting' || kind === 'post_retrying') {
    const max = kind === 'post_retrying' ? POST_MAX_RETRIES : 5;
    const label =
      title ||
      (kind === 'post_retrying'
        ? t('reconnect.postRetryTitle')
        : t('reconnect.reconnectingTitle'));
    line = `${label} (${attempt}/${max})`;
  } else if (message) {
    line = line ? `${line} · ${message}` : message;
  }

  if (!line) return null;

  const className =
    kind === 'connection_error'
      ? 'text-destructive text-sm'
      : 'text-muted-foreground fade-in animate-in text-sm duration-200';

  return (
    <div role={kind === 'connection_error' ? 'alert' : 'status'} className={className}>
      {line}
    </div>
  );
}

/** Reconnect status on the next line of the active assistant reply. */
export function NetworkReconnectInAssistant() {
  const isLast = useAuiState((s) => s.message.isLast);
  const kind = useNetworkReconnectStore((s) => s.kind);

  if (!isLast || !isInlineReconnectKind(kind)) return null;

  return <NetworkReconnectStatus />;
}

/**
 * Fallback when reconnecting after a user message was sent but before any
 * assistant reply exists. Stays hidden on an empty thread (welcome screen).
 */
export function NetworkReconnectThreadFallback() {
  const lastRole = useAuiState((s) => s.thread.messages.at(-1)?.role);
  const kind = useNetworkReconnectStore((s) => s.kind);

  if (lastRole !== 'user' || !isInlineReconnectKind(kind)) return null;

  return (
    <div
      data-slot="aui_assistant-message-content"
      className="text-foreground flex flex-col gap-2 px-2 leading-relaxed"
    >
      <NetworkReconnectStatus />
    </div>
  );
}
