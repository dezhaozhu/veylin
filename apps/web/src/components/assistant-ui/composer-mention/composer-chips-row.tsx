import { ComposerPrimitive } from '@assistant-ui/react';
import type { FC } from 'react';
import { AttachmentUI } from '@/components/assistant-ui/attachment';
import { ComposerBrowserRefChip } from '@/components/assistant-ui/composer-mention/composer-browser-ref-chip';
import { ComposerContextTokens } from '@/components/assistant-ui/composer-context-tokens';
import { ComposerActivatedSkills } from '@/components/assistant-ui/composer-activated-skills';

/** Attachments, browser @ refs, and pending /skill chips in one horizontal row. */
export const ComposerChipsRow: FC = () => {
  return (
    <div className="aui-composer-chips flex w-full flex-nowrap items-center gap-2 overflow-x-auto px-2.5 pt-1 empty:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <ComposerPrimitive.Attachments>{() => <AttachmentUI />}</ComposerPrimitive.Attachments>
      <ComposerBrowserRefChip />
      <ComposerActivatedSkills />
      <ComposerContextTokens />
    </div>
  );
};
