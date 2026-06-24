import { useAuiState } from '@assistant-ui/react';
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
  const kind = useNetworkReconnectStore((s) => s.kind);
  const attempt = useNetworkReconnectStore((s) => s.reconnectAttempt);
  const title = useNetworkReconnectStore((s) => s.title);
  const message = useNetworkReconnectStore((s) => s.message);

  if (!kind || !isInlineReconnectKind(kind)) return null;

  if (kind === 'reconnecting' || kind === 'post_retrying') {
    const max = kind === 'post_retrying' ? POST_MAX_RETRIES : 5;
    return (
      <div
        role="status"
        className="text-muted-foreground fade-in animate-in text-sm duration-200"
      >
        Reconnecting... {attempt}/{max}
      </div>
    );
  }

  if (kind === 'offline') {
    return (
      <div role="status" className="text-muted-foreground text-sm">
        {title}
        {message ? ` · ${message}` : null}
      </div>
    );
  }

  if (kind === 'connection_error') {
    return (
      <div role="alert" className="text-destructive text-sm">
        {title}
        {message ? ` · ${message}` : null}
      </div>
    );
  }

  return null;
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
