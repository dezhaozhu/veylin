import { Button } from '@/components/ui/button';
import {
  ComposerPrimitive,
  QueueItemPrimitive,
  useAuiState,
} from '@assistant-ui/react';
import type { AppendMessage, CreateAttachment } from '@assistant-ui/core';
import {
  CornerDownLeftIcon,
  CornerDownRightIcon,
  PencilIcon,
  Trash2Icon,
} from 'lucide-react';
import { useCallback, type FC, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { getComposerQueueRuntime } from '@/lib/composer-queue-runtime';
import {
  resolveEnterWhileRunning,
  shouldInterceptTabForQueue,
} from '@/lib/composer-submit-keys';
import { cn } from '@/lib/utils';
import { useAui } from '@assistant-ui/store';

function focusComposerInput(): void {
  document
    .querySelector<HTMLTextAreaElement>('.aui-composer-input')
    ?.focus();
}

async function restoreDraftToComposer(
  draft: AppendMessage,
  setText: (text: string) => void,
  clearAttachments: () => Promise<void>,
  addAttachment: (fileOrAttachment: File | CreateAttachment) => Promise<void>,
): Promise<void> {
  const text = draft.content
    .filter((part) => part.type === 'text')
    .map((part) => (part as { text: string }).text)
    .join('\n\n');
  setText(text);
  await clearAttachments();
  for (const attachment of draft.attachments ?? []) {
    if (attachment.file) {
      await addAttachment(attachment.file);
      continue;
    }
    if ('content' in attachment && Array.isArray(attachment.content)) {
      await addAttachment({
        name: attachment.name,
        content: attachment.content,
      } as CreateAttachment);
    }
  }
  focusComposerInput();
}

function QueueItemEditButton({ queueItemId }: { queueItemId: string }) {
  const aui = useAui();
  const { t } = useTranslation();

  const editMessage = useCallback(async () => {
    const runtime = getComposerQueueRuntime();
    const draft = runtime?.popQueuedMessage(queueItemId);
    if (!draft) return;
    const composer = aui.composer();
    await restoreDraftToComposer(
      draft,
      (text) => composer.setText(text),
      () => composer.clearAttachments(),
      (fileOrAttachment) => composer.addAttachment(fileOrAttachment),
    );
  }, [aui, queueItemId]);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="text-muted-foreground size-7 shrink-0"
      aria-label={t('queue.editMessage')}
      title={t('queue.editMessage')}
      onClick={() => void editMessage()}
    >
      <PencilIcon className="size-3.5" />
    </Button>
  );
}

/** Pending messages while the agent is still running (agent-style queue). */
export const ComposerQueue: FC = () => {
  const { t } = useTranslation();
  const count = useAuiState((s) => s.composer.queue.length);
  if (count === 0) return null;

  return (
    <div
      className={cn(
        'aui-composer-queue border-border/60 bg-(--composer-bg) -mb-(--composer-radius) mx-3 flex w-[calc(100%-1.5rem)] flex-col self-center overflow-hidden rounded-t-(--composer-radius) border border-b-0 pb-(--composer-radius) dark:border-muted-foreground/15',
      )}
    >
      <ComposerPrimitive.Queue>
        {({ queueItem }) => (
          <div
            key={queueItem.id}
            className="border-border/40 flex items-center gap-2 border-b px-3 py-2 text-sm last:border-b-0"
          >
            <CornerDownRightIcon className="text-muted-foreground size-3.5 shrink-0" />
            <span className="text-muted-foreground min-w-0 flex-1 truncate">
              {queueItem.prompt}
            </span>
            <div className="flex shrink-0 items-center">
              <QueueItemPrimitive.Steer asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground h-7 gap-1 px-2 text-xs"
                  aria-label={t('queue.steer')}
                  title={t('queue.steerHint')}
                >
                  <CornerDownLeftIcon className="size-3.5" />
                  {t('queue.steer')}
                </Button>
              </QueueItemPrimitive.Steer>
              <QueueItemPrimitive.Remove asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground size-7 shrink-0"
                  aria-label={t('queue.remove')}
                >
                  <Trash2Icon className="size-3.5" />
                </Button>
              </QueueItemPrimitive.Remove>
              <QueueItemEditButton queueItemId={queueItem.id} />
            </div>
          </div>
        )}
      </ComposerPrimitive.Queue>
    </div>
  );
};

/** Codex-style keys: Enter always queues while running, Tab queue. */
export function useComposerSubmitKeys(): (e: KeyboardEvent) => void {
  const aui = useAui();
  return useCallback(
    (e: KeyboardEvent) => {
      if (e.nativeEvent.isComposing) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const thread = aui.thread().getState();
      const composer = aui.composer().getState();
      const keyState = {
        isRunning: thread.isRunning,
        canQueue: thread.capabilities.queue,
        composerEmpty: composer.isEmpty,
      };

      if (e.key === 'Tab' && !e.shiftKey) {
        if (!shouldInterceptTabForQueue(keyState)) return;
        e.preventDefault();
        e.stopPropagation();
        aui.composer().send();
        return;
      }

      if (e.key !== 'Enter' || e.shiftKey) return;

      const enterAction = resolveEnterWhileRunning(keyState);
      if (enterAction === 'ignore') return;

      e.preventDefault();
      e.stopPropagation();
      aui.composer().send();
    },
    [aui],
  );
}
