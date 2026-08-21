import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { loginDesktop } from '@/hooks/use-session';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
};

export function DesktopLoginDialog({ open, onOpenChange, onSuccess }: Props) {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = await loginDesktop(username.trim(), password);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPassword('');
    onOpenChange(false);
    onSuccess?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('userMenu.signIn')}</DialogTitle>
          <DialogDescription>{t('userMenu.signInHint')}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => void onSubmit(e)}>
          <div className="grid gap-1.5">
            <label className="text-sm font-medium" htmlFor="desktop-login-username">
              {t('userMenu.username')}
            </label>
            <Input
              id="desktop-login-username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={submitting}
              required
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-sm font-medium" htmlFor="desktop-login-password">
              {t('userMenu.password')}
            </label>
            <Input
              id="desktop-login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              required
            />
          </div>
          {error && <p className="text-destructive text-sm">{error}</p>}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => onOpenChange(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? t('userMenu.signingIn') : t('userMenu.signIn')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
