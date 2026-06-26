import { useAuiState } from '@assistant-ui/store';
import type { FC } from 'react';

/** User bubble text only — hides internal data parts (e.g. pending skill marker). */
export const UserMessageText: FC = () => {
  const text = useAuiState((s) =>
    s.message.content
      .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
      .map((part) => part.text)
      .join('\n'),
  );

  if (!text) return null;
  return <>{text}</>;
};
