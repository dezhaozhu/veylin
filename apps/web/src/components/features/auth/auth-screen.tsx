import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiUrl } from '@/lib/api-base';

type Mode = 'sign-in' | 'sign-up';

export function AuthScreen({ onAuthenticated }: { onAuthenticated: () => void }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const path =
        mode === 'sign-in' ? '/api/auth/sign-in/email' : '/api/auth/sign-up/email';
      const body =
        mode === 'sign-in'
          ? { email: email.trim(), password }
          : { email: email.trim(), password, name: name.trim() || email.trim() };
      const res = await fetch(apiUrl(path), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || res.statusText);
      }
      onAuthenticated();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-background flex min-h-dvh items-center justify-center p-6">
      <form
        onSubmit={(e) => void submit(e)}
        className="border-border bg-card w-full max-w-sm space-y-4 rounded-xl border p-6 shadow-sm"
      >
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {mode === 'sign-in' ? t('auth.signIn') : t('auth.signUp')}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">{t('auth.hint')}</p>
        </div>

        {mode === 'sign-up' && (
          <div>
            <label className="mb-1.5 block text-sm font-medium">{t('auth.name')}</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              disabled={busy}
            />
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-sm font-medium">{t('auth.email')}</label>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
            disabled={busy}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium">{t('auth.password')}</label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
            required
            minLength={8}
            disabled={busy}
          />
        </div>

        {error && <p className="text-destructive text-sm">{error}</p>}

        <Button type="submit" className="w-full" disabled={busy}>
          {busy
            ? t('auth.working')
            : mode === 'sign-in'
              ? t('auth.signIn')
              : t('auth.signUp')}
        </Button>

        <button
          type="button"
          className="text-muted-foreground hover:text-foreground w-full text-center text-sm"
          onClick={() => {
            setMode((m) => (m === 'sign-in' ? 'sign-up' : 'sign-in'));
            setError(null);
          }}
          disabled={busy}
        >
          {mode === 'sign-in' ? t('auth.needAccount') : t('auth.haveAccount')}
        </button>
      </form>
    </div>
  );
}
