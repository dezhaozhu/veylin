import { lazy, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  return (
    <div className="bg-background text-foreground flex min-h-dvh items-center justify-center p-8">
      <p className="text-muted-foreground text-sm">{t('splash.loadingApp')}</p>
    </div>
  );
}
