import { create } from 'zustand';
import i18n from '@/i18n';

export type NetworkBannerKind =
  | 'offline'
  | 'reconnecting'
  | 'post_retrying'
  | 'connection_error'
  | null;

export type NetworkBannerState = {
  kind: NetworkBannerKind;
  /** Short headline for error banners. */
  title: string | null;
  /** Body copy or reconnect status line. */
  message: string | null;
  reconnectAttempt: number;
  elapsedSec: number;
};

type NetworkReconnectStore = NetworkBannerState & {
  setOffline: (offline: boolean) => void;
  setReconnecting: (info: {
    attempt: number;
    delayMs: number;
    elapsedMs: number;
    reason: string;
  }) => void;
  setPostRetrying: (info: {
    attempt: number;
    delayMs: number;
    reason: string;
  }) => void;
  clearReconnecting: () => void;
  setConnectionError: (title: string, detail: string) => void;
  clearBanner: () => void;
  clearTransientBanner: () => void;
};

const idle: NetworkBannerState = {
  kind: null,
  title: null,
  message: null,
  reconnectAttempt: 0,
  elapsedSec: 0,
};

function reasonLabel(reason: string): string {
  const t = i18n.t.bind(i18n);
  if (reason === 'liveness_timeout') return t('reconnect.livenessTimeout');
  if (reason === 'network_offline') return t('reconnect.networkOffline');
  if (reason === 'stream_resume') return t('reconnect.streamResume');
  if (reason.startsWith('http_'))
    return t('reconnect.serviceUnavailable', { code: reason.replace('http_', '') });
  if (reason === 'stream_ended_before_first_byte') return t('reconnect.streamEnded');
  return t('reconnect.disconnected');
}

export const useNetworkReconnectStore = create<NetworkReconnectStore>((set, get) => ({
  ...idle,
  setOffline: (offline) => {
    if (offline) {
      set({
        kind: 'offline',
        title: i18n.t('reconnect.offlineTitle'),
        message: i18n.t('reconnect.offlineBody'),
        reconnectAttempt: 0,
        elapsedSec: 0,
      });
      return;
    }
    if (get().kind === 'offline') {
      set({ ...idle });
    }
  },
  setReconnecting: ({ attempt, delayMs, elapsedMs, reason }) => {
    const seconds = Math.max(1, Math.ceil(delayMs / 1000));
    const elapsedSec = Math.round(elapsedMs / 1000);
    set({
      kind: 'reconnecting',
      title: i18n.t('reconnect.reconnectingTitle'),
      reconnectAttempt: attempt,
      elapsedSec,
      message: i18n.t('reconnect.reconnectingMsg', {
        reason: reasonLabel(reason),
        elapsed: elapsedSec,
        seconds,
      }),
    });
  },
  setPostRetrying: ({ attempt, delayMs, reason }) => {
    const seconds = Math.max(1, Math.ceil(delayMs / 1000));
    set({
      kind: 'post_retrying',
      title: i18n.t('reconnect.postRetryTitle'),
      reconnectAttempt: attempt,
      elapsedSec: 0,
      message: i18n.t('reconnect.postRetryMsg', {
        reason: reasonLabel(reason),
        seconds,
      }),
    });
  },
  clearReconnecting: () => {
    const kind = get().kind;
    if (kind === 'reconnecting' || kind === 'post_retrying') {
      set({ ...idle });
    }
  },
  setConnectionError: (title, detail) => {
    set({
      kind: 'connection_error',
      title,
      message: detail,
      reconnectAttempt: 0,
      elapsedSec: 0,
    });
  },
  clearBanner: () => set({ ...idle }),
  clearTransientBanner: () => {
    const kind = get().kind;
    if (kind === 'offline' || kind === null) return;
    set({ ...idle });
  },
}));
