import { MessageCircleQuestionIcon } from 'lucide-react';
import { useCallback, type FC } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useAui } from '@assistant-ui/store';
import { Button } from '@/components/ui/button';
import { placeComposerCaret } from '@/lib/composer-caret';
import {
  clearThreadTextSelection,
  formatSelectionAskComposerText,
} from '@/lib/thread-selection-ask';
import { useThreadSelectionAsk } from '@/hooks/use-thread-selection-ask';

export const ThreadSelectionAskToolbar: FC = () => {
  const { t } = useTranslation();
  const aui = useAui();
  const { anchor, dismiss } = useThreadSelectionAsk();

  const askAboutSelection = useCallback(() => {
    if (!anchor) return;
    const composer = aui.composer();
    const current = composer.getState().text;
    const prefix = formatSelectionAskComposerText(anchor.text);
    const next = current.trim() ? `${current.trimEnd()}\n\n${prefix}` : prefix;
    composer.setText(next);
    clearThreadTextSelection();
    dismiss();
    placeComposerCaret(next.length);
  }, [anchor, aui, dismiss]);

  if (!anchor) return null;

  return createPortal(
    <div
      className="pointer-events-none fixed z-[202]"
      style={{
        top: Math.max(8, anchor.top - 8),
        left: anchor.left,
        transform: 'translate(-50%, -100%)',
      }}
    >
      <div className="pointer-events-auto flex items-center rounded-full border bg-popover p-0.5 shadow-md">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-foreground hover:bg-accent h-8 rounded-full px-3 text-sm shadow-none"
          onMouseDown={(event) => event.preventDefault()}
          onClick={askAboutSelection}
        >
          <MessageCircleQuestionIcon className="size-4" />
          {t('thread.selectionAsk')}
        </Button>
      </div>
    </div>,
    document.body,
  );
};
