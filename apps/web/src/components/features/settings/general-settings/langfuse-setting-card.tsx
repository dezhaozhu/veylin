import { useCallback, useEffect, useState, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { settingsApi, type LangfuseSettings } from '@/hooks/settings/api';
import { SettingsSwitch } from '../settings-switch';
import { cn } from '@/lib/utils';

const DEFAULT_BASE_URL = 'https://cloud.langfuse.com';

function FieldInput({
  className,
  ...props
}: ComponentProps<typeof Input>) {
  return (
    <div className="bg-muted/60 overflow-hidden rounded-xl">
      <Input
        data-no-window-drag
        {...props}
        className={cn(
          'h-10 border-0 bg-transparent px-3 shadow-none select-text focus-visible:ring-0',
          className,
        )}
        onMouseDown={(e) => {
          e.stopPropagation();
          props.onMouseDown?.(e);
        }}
      />
    </div>
  );
}

export function LangfuseSettingCard() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const [enabled, setEnabled] = useState(false);
  const [publicKey, setPublicKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [hasSecretKey, setHasSecretKey] = useState(false);

  const applyView = useCallback((settings: LangfuseSettings) => {
    setEnabled(settings.enabled);
    setPublicKey(settings.publicKey);
    setBaseUrl(settings.baseUrl || DEFAULT_BASE_URL);
    setHasSecretKey(settings.hasSecretKey);
    setSecretKey('');
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const { settings } = await settingsApi.getLangfuseSettings();
        if (!cancelled) applyView(settings);
      } catch {
        if (!cancelled) setError(t('settings.langfuse.loadFailed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyView, t]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSavedFlash(false);
    try {
      const body: {
        enabled: boolean;
        publicKey: string;
        baseUrl: string;
        secretKey?: string;
      } = {
        enabled,
        publicKey: publicKey.trim(),
        baseUrl: baseUrl.trim() || DEFAULT_BASE_URL,
      };
      if (secretKey.trim()) {
        body.secretKey = secretKey.trim();
      }
      const { settings } = await settingsApi.updateLangfuseSettings(body);
      applyView(settings);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2000);
    } catch {
      setError(t('settings.langfuse.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const busy = loading || saving;

  const onEnabledChange = (on: boolean) => {
    setEnabled(on);
    if (!on) {
      // Persist disable immediately so the clean closed card still takes effect.
      void (async () => {
        setSaving(true);
        setError(null);
        try {
          const { settings } = await settingsApi.updateLangfuseSettings({
            enabled: false,
            publicKey: publicKey.trim(),
            baseUrl: baseUrl.trim() || DEFAULT_BASE_URL,
            ...(secretKey.trim() ? { secretKey: secretKey.trim() } : {}),
          });
          applyView(settings);
        } catch {
          setEnabled(true);
          setError(t('settings.langfuse.saveFailed'));
        } finally {
          setSaving(false);
        }
      })();
    }
  };

  return (
    <div className="border-border bg-card mt-4 rounded-xl border">
      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">{t('settings.langfuse.title')}</div>
          <div className="text-muted-foreground text-xs">{t('settings.langfuse.hint')}</div>
        </div>
        <SettingsSwitch
          checked={enabled}
          onChange={onEnabledChange}
          label={t('settings.langfuse.enabled')}
          className={loading ? 'opacity-50' : undefined}
        />
      </div>

      {enabled && (
        <>
          <div className="border-border space-y-4 border-t px-4 py-4">
            <div>
              <div className="mb-2 text-sm font-medium">{t('settings.langfuse.publicKey')}</div>
              <FieldInput
                value={publicKey}
                placeholder={t('settings.langfuse.publicKeyPlaceholder')}
                onChange={(e) => setPublicKey(e.target.value)}
                disabled={busy}
              />
            </div>

            <div>
              <div className="mb-2 text-sm font-medium">{t('settings.langfuse.secretKey')}</div>
              <p className="text-muted-foreground mb-2 text-xs">
                {hasSecretKey
                  ? t('settings.langfuse.secretKeyHintSaved')
                  : t('settings.langfuse.secretKeyHint')}
              </p>
              <FieldInput
                type="password"
                value={secretKey}
                placeholder={t('settings.langfuse.secretKeyPlaceholder')}
                onChange={(e) => setSecretKey(e.target.value)}
                disabled={busy}
                autoComplete="off"
              />
            </div>

            <div>
              <div className="mb-2 text-sm font-medium">{t('settings.langfuse.baseUrl')}</div>
              <FieldInput
                value={baseUrl}
                placeholder={DEFAULT_BASE_URL}
                onChange={(e) => setBaseUrl(e.target.value)}
                disabled={busy}
              />
            </div>
          </div>

          <div className="space-y-3 px-4 pt-1 pb-4">
            {error && <p className="text-destructive text-sm">{error}</p>}
            {savedFlash && !error && (
              <p className="text-muted-foreground text-sm">{t('settings.langfuse.saved')}</p>
            )}
            <Button
              type="button"
              className="w-full"
              onClick={() => void save()}
              disabled={busy}
            >
              {saving ? t('settings.langfuse.saving') : t('settings.langfuse.save')}
            </Button>
          </div>
        </>
      )}

      {!enabled && error && (
        <p className="text-destructive px-4 pb-3 text-sm">{error}</p>
      )}
    </div>
  );
}
