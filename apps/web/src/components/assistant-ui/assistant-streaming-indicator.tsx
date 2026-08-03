'use client';

import { useAuiState } from '@assistant-ui/react';
import { useTranslation } from 'react-i18next';

/** Trailing ● — hide when visible text already signals progress or the turn has settled. */
export function AssistantStreamingIndicator() {
  const { t } = useTranslation();
  const show = useAuiState((s) => {
    if (s.message.status?.type !== 'running') return false;

    const parts = s.message.parts;
    if (parts.length === 0) return true;

    const last = parts[parts.length - 1];
    if (!last) return true;

    if (last.type === 'text' || last.type === 'reasoning') {
      return false;
    }

    const hasSubstantiveText = parts.some(
      (p) => p.type === 'text' && 'text' in p && p.text.trim().length > 20,
    );
    if (hasSubstantiveText && last.type === 'tool-call') {
      return false;
    }

    return true;
  });

  if (!show) return null;

  return (
    <span
      data-slot="aui_assistant-message-indicator"
      className="animate-pulse font-sans"
      aria-label={t('thread.assistantWorking')}
    >
      {'●'}
    </span>
  );
}
