import { lazy, Suspense, useEffect, useState } from 'react';
import i18n from '@/i18n';

const AssistantChat = lazy(() =>
  import('./AssistantChat').then((m) => ({ default: m.AssistantChat })),
);

export function App() {
  const [, setLanguageVersion] = useState(0);

  useEffect(() => {
    const bump = () => setLanguageVersion((version) => version + 1);
    i18n.on('languageChanged', bump);
    return () => {
      i18n.off('languageChanged', bump);
    };
  }, []);

  return (
    <Suspense fallback={<AppLoadingFallback />}>
      <AssistantChat />
    </Suspense>
  );
}

function AppLoadingFallback() {
  return <div className="bg-background min-h-dvh" aria-hidden="true" />;
}
