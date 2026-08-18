import { PaperclipIcon } from 'lucide-react';
import type { FC } from 'react';
import { useTranslation } from 'react-i18next';

/** Gemini-style drop hint: dashed frame, paperclip, sits over the composer. */
export const ComposerDropOverlay: FC = () => {
  const { t } = useTranslation();
  return (
    <div
      className="pointer-events-none absolute inset-0 z-20 hidden flex-col items-center justify-center gap-2 rounded-[inherit] border-2 border-dashed border-blue-500 bg-blue-50/90 text-blue-600 group-data-[dragging=true]/composer-drop:flex dark:border-blue-400 dark:bg-blue-950/80 dark:text-blue-300"
      aria-hidden
    >
      <PaperclipIcon className="size-7 stroke-[1.75]" />
      <p className="text-sm font-medium">{t('thread.dropFilesHere')}</p>
    </div>
  );
};
