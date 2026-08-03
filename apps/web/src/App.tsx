import { lazy, Suspense, useEffect, useState } from 'react';
import i18n from '@/i18n';
import { useSession } from '@/hooks/use-session';
import { AuthScreen } from '@/components/features/auth/auth-screen';

const AssistantChat = lazy(() =>
  import('./AssistantChat').then((m) => ({ default: m.AssistantChat })),
);

export function App() {
  const [, setLanguageVersion] = useState(0);
  const { user, loading, needsAuth, refresh, isDesktop } = useSession();

  useEffect(() => {
    const bump = () => setLanguageVersion((version) => version + 1);
    i18n.on('languageChanged', bump);
    return () => {
      i18n.off('languageChanged', bump);
    };
  }, []);

  if (loading) {
    return <AppLoadingFallback />;
  }

  if (!isDesktop && needsAuth && !user) {
    return <AuthScreen onAuthenticated={() => void refresh()} />;
  }

  return (
    <Suspense fallback={<AppLoadingFallback />}>
      <AssistantChat />
    </Suspense>
  );
}

function AppLoadingFallback() {
  return <div className="bg-background min-h-dvh" aria-hidden="true" />;
}
