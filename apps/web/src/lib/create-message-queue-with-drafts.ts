import type { AppendMessage } from '@assistant-ui/core';
import { generateId } from 'ai';

type QueueItemState = {
  readonly id: string;
  readonly prompt: string;
};

const EMPTY_QUEUE_ITEMS: readonly QueueItemState[] = Object.freeze([]);

type MessageQueueDriver = {
  run: (message: AppendMessage, options: { steer: boolean }) => void;
  cancel?: (() => void) | undefined;
};

type ExternalThreadQueueAdapter = {
  items: readonly QueueItemState[];
  enqueue: (message: AppendMessage, options: { steer: boolean }) => void;
  steer: (queueItemId: string) => void;
  remove: (queueItemId: string) => void;
  clear: (reason: 'edit' | 'reload' | 'cancel-run') => void;
};

function getMessageText(message: AppendMessage): string {
  return message.content
    .filter((part) => part.type === 'text')
    .map((part) => (part as { text: string }).text)
    .join('\n\n');
}

export type MessageQueueControllerWithDrafts = {
  readonly adapter: ExternalThreadQueueAdapter;
  notifyBusy: () => void;
  notifyIdle: () => void;
  subscribe: (callback: () => void) => () => void;
  getQueuedMessage: (queueItemId: string) => AppendMessage | undefined;
  popQueuedMessage: (queueItemId: string) => AppendMessage | undefined;
  takeCancelRestorePrompts: () => readonly string[];
};

export const createMessageQueueWithDrafts = (
  driver: MessageQueueDriver,
): MessageQueueControllerWithDrafts => {
  let items: readonly QueueItemState[] = EMPTY_QUEUE_ITEMS;
  const messages = new Map<string, AppendMessage>();
  const subscribers = new Set<() => void>();
  let cancelRestorePrompts: string[] = [];

  let running = false;
  let suppressIdle = 0;

  const notify = () => {
    for (const callback of subscribers) callback();
  };

  const setItems = (next: readonly QueueItemState[]) => {
    items = next;
    adapter.items = next;
    notify();
  };

  const advance = () => {
    if (running || items.length === 0) return;
    const head = items[0]!;
    const message = messages.get(head.id);
    messages.delete(head.id);
    setItems(items.slice(1));
    if (!message) return;
    running = true;
    driver.run(message, { steer: false });
  };

  const enqueue = (message: AppendMessage, { steer }: { steer: boolean }) => {
    const id = generateId();
    const prompt = getMessageText(message);
    messages.set(id, message);
    setItems([...items, { id, prompt }]);
    if (steer) {
      steerItem(id);
    } else {
      advance();
    }
  };

  const steerItem = (queueItemId: string) => {
    if (!messages.has(queueItemId)) return;

    if (driver.cancel && running) {
      const message = messages.get(queueItemId)!;
      messages.delete(queueItemId);
      setItems(items.filter((item) => item.id !== queueItemId));
      suppressIdle++;
      driver.cancel();
      running = true;
      driver.run(message, { steer: true });
      return;
    }

    const target = items.find((item) => item.id === queueItemId);
    if (!target) return;
    setItems([target, ...items.filter((item) => item.id !== queueItemId)]);
    advance();
  };

  const remove = (queueItemId: string) => {
    if (!messages.delete(queueItemId)) return;
    setItems(items.filter((item) => item.id !== queueItemId));
  };

  const clear = (reason: 'edit' | 'reload' | 'cancel-run') => {
    if (reason === 'cancel-run' && items.length > 0) {
      cancelRestorePrompts = items.map((item) => item.prompt);
    }
    if (items.length === 0) return;
    messages.clear();
    setItems(EMPTY_QUEUE_ITEMS);
  };

  const adapter: ExternalThreadQueueAdapter = {
    items,
    enqueue,
    steer: steerItem,
    remove,
    clear,
  };

  return {
    adapter,
    notifyBusy: () => {
      running = true;
    },
    notifyIdle: () => {
      if (suppressIdle > 0) {
        suppressIdle--;
        return;
      }
      running = false;
      advance();
    },
    subscribe: (callback) => {
      subscribers.add(callback);
      return () => {
        subscribers.delete(callback);
      };
    },
    getQueuedMessage: (queueItemId) => messages.get(queueItemId),
    popQueuedMessage: (queueItemId) => {
      const message = messages.get(queueItemId);
      if (!message) return undefined;
      remove(queueItemId);
      return message;
    },
    takeCancelRestorePrompts: () => {
      const snapshot = cancelRestorePrompts;
      cancelRestorePrompts = [];
      return snapshot;
    },
  };
};
