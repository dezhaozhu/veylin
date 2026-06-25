import { useEffect, useState } from 'react';
import { AssistantChat } from './AssistantChat';
import i18n from '@/i18n';

export function App() {
  const [, setLanguageVersion] = useState(0);

  useEffect(() => {
    const bump = () => setLanguageVersion((version) => version + 1);
    i18n.on('languageChanged', bump);
    return () => {
      i18n.off('languageChanged', bump);
    };
  }, []);

  return <AssistantChat />;
}
