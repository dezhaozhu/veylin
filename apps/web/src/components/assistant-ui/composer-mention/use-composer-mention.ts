import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { subscribeLayoutSync } from '@/lib/overlay-bounds';

export type MentionTrigger = {
  query: string;
  start: number;
  end: number;
};

export function detectMention(text: string, cursor: number): MentionTrigger | null {
  const before = text.slice(0, cursor);
  const match = before.match(/@([^\s@]*)$/);
  if (!match) return null;
  const token = match[0];
  return {
    query: match[1] ?? '',
    start: cursor - token.length,
    end: cursor,
  };
}

type MenuAnchor = {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
};

export function useComposerMentionAnchor(open: boolean) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);

  const bindInputRef = useCallback((node: HTMLTextAreaElement | null) => {
    inputRef.current = node;
  }, []);

  const updateAnchor = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setAnchor({
      left: rect.left + 8,
      width: Math.min(320, rect.width - 16),
      bottom: window.innerHeight - rect.top + 6,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setAnchor(null);
      return;
    }
    updateAnchor();
    const stopLayout = subscribeLayoutSync(updateAnchor);
    window.addEventListener('scroll', updateAnchor, true);
    return () => {
      stopLayout();
      window.removeEventListener('scroll', updateAnchor, true);
    };
  }, [open, updateAnchor]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  return { inputRef, bindInputRef, anchor, updateAnchor };
}

export function removeMentionRange(text: string, trigger: MentionTrigger): string {
  return text.slice(0, trigger.start) + text.slice(trigger.end);
}
