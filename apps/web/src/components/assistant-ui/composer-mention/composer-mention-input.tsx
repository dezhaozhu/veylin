import { ComposerPrimitive, useAuiState } from '@assistant-ui/react';
import { useCallback, useState, type FC } from 'react';
import { ComposerMentionMenu } from '@/components/assistant-ui/composer-mention/composer-mention-menu';
import { ComposerSlashMenu } from '@/components/assistant-ui/composer-mention/composer-slash-menu';
import { detectSlashCommand } from '@/components/assistant-ui/composer-mention/use-composer-slash';
import {
  detectMention,
  useComposerMentionAnchor,
  type MentionTrigger,
} from '@/components/assistant-ui/composer-mention/use-composer-mention';
import { usePendingSkill } from '@/lib/use-composer-settings';
import { isImeComposing } from '@/lib/composer-submit-keys';
import { useOverlayDismiss } from '@/lib/overlay-dismiss';

type ComposerMentionInputProps = React.ComponentProps<typeof ComposerPrimitive.Input>;

export const ComposerMentionInput: FC<ComposerMentionInputProps> = ({
  onChange,
  onKeyDown,
  className,
  submitOnEnter: _submitOnEnter,
  ...props
}) => {
  const [mentionTrigger, setMentionTrigger] = useState<MentionTrigger | null>(null);
  const [slashTrigger, setSlashTrigger] = useState<MentionTrigger | null>(null);
  const { pendingSkill, setPendingSkill } = usePendingSkill();
  const composerEmpty = useAuiState((s) => s.composer.isEmpty);

  const menuOpen = mentionTrigger != null || slashTrigger != null;
  const { bindInputRef, anchor, updateAnchor } = useComposerMentionAnchor(menuOpen);

  const mergeRef = useCallback(
    (node: HTMLTextAreaElement | null) => {
      bindInputRef(node);
    },
    [bindInputRef],
  );

  const closeMenus = useCallback(() => {
    setMentionTrigger(null);
    setSlashTrigger(null);
  }, []);

  useOverlayDismiss(closeMenus);

  const syncTriggers = useCallback(
    (value: string, cursor: number) => {
      const mention = detectMention(value, cursor);
      if (mention) {
        setMentionTrigger(mention);
        setSlashTrigger(null);
        updateAnchor();
        return;
      }

      const slash = detectSlashCommand(value, cursor);
      setMentionTrigger(null);
      setSlashTrigger(slash);
      if (slash) updateAnchor();
    },
    [updateAnchor],
  );

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange?.(event);
      syncTriggers(event.target.value, event.target.selectionStart ?? event.target.value.length);
    },
    [onChange, syncTriggers],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (isImeComposing(event)) {
        if (event.key === 'Enter') {
          event.preventDefault();
        }
        return;
      }

      const menuActive = mentionTrigger ?? slashTrigger;

      if (menuActive) {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          closeMenus();
        } else if (
          ['ArrowUp', 'ArrowDown', 'Enter'].includes(event.key) &&
          event.key !== 'Escape'
        ) {
          event.preventDefault();
          event.stopPropagation();
        }
      }

      if (
        event.key === 'Backspace' &&
        pendingSkill &&
        composerEmpty &&
        !menuActive
      ) {
        setPendingSkill(null);
        event.preventDefault();
        onKeyDown?.(event);
        return;
      }

      onKeyDown?.(event);
      if (!event.defaultPrevented) {
        const target = event.currentTarget;
        queueMicrotask(() => {
          syncTriggers(target.value, target.selectionStart ?? target.value.length);
        });
      }
    },
    [
      onKeyDown,
      syncTriggers,
      mentionTrigger,
      slashTrigger,
      pendingSkill,
      composerEmpty,
      setPendingSkill,
      closeMenus,
    ],
  );

  const handleSelect = useCallback(
    (event: React.SyntheticEvent<HTMLTextAreaElement>) => {
      const target = event.currentTarget;
      syncTriggers(target.value, target.selectionStart ?? target.value.length);
    },
    [syncTriggers],
  );

  const closeMentionMenu = useCallback(() => setMentionTrigger(null), []);
  const closeSlashMenu = useCallback(() => setSlashTrigger(null), []);

  return (
    <>
      <ComposerPrimitive.Input
        {...props}
        submitMode="none"
        className={className}
        ref={mergeRef}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onSelect={handleSelect}
        onClick={handleSelect}
      />
      {mentionTrigger && anchor && (
        <ComposerMentionMenu
          open
          trigger={mentionTrigger}
          anchor={anchor}
          onClose={closeMentionMenu}
          onClearTrigger={closeMentionMenu}
        />
      )}
      {slashTrigger && anchor && (
        <ComposerSlashMenu
          open
          trigger={slashTrigger}
          anchor={anchor}
          onClose={closeSlashMenu}
        />
      )}
    </>
  );
};
