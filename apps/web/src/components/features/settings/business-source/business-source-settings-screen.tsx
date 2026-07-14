import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { SettingsSwitch } from '../settings-switch';
import { settingsApi, type BusinessSourceSettings } from '@/hooks/settings/api';

const EMPTY: BusinessSourceSettings = {
  enabled: false,
  mcpServerName: 'business',
  hasCredential: false,
  toolAllowlist: [],
  url: '',
  transport: 'http',
};

export function BusinessSourceSettingsScreen() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [source, setSource] = useState<BusinessSourceSettings>(EMPTY);
  const [authorization, setAuthorization] = useState('');
  const [allowlistText, setAllowlistText] = useState('');
  const [auditWebhookUrl, setAuditWebhookUrl] = useState('');

  const apply = useCallback((s: BusinessSourceSettings) => {
    setSource(s);
    setAllowlistText((s.toolAllowlist ?? []).join(', '));
    setAuthorization('');
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const [{ source: s }, audit] = await Promise.all([
          settingsApi.getBusinessSource(),
          settingsApi.getAuditSettings(),
        ]);
        if (!cancelled) {
          apply(s);
          setAuditWebhookUrl(audit.settings.webhookUrl ?? '');
        }
      } catch {
        if (!cancelled) setError(t('settings.business.loadFailed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apply, t]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    setTestResult(null);
    try {
      const toolAllowlist = allowlistText
        .split(/[,，\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const [{ source: s }, audit] = await Promise.all([
        settingsApi.updateBusinessSource({
          enabled: source.enabled,
          mcpServerName: source.mcpServerName.trim() || 'business',
          url: source.url?.trim() || '',
          transport: source.transport === 'sse' ? 'sse' : 'http',
          toolAllowlist,
          ...(authorization.trim() ? { authorization: authorization.trim() } : {}),
        }),
        settingsApi.updateAuditSettings({
          webhookUrl: auditWebhookUrl.trim(),
        }),
      ]);
      apply(s);
      setAuditWebhookUrl(audit.settings.webhookUrl ?? '');
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch {
      setError(t('settings.business.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setError(null);
    setTestResult(null);
    try {
      const res = await settingsApi.testBusinessSource();
      if (res.ok) {
        const tools = (res.tools ?? []).slice(0, 8).join(', ');
        setTestResult(
          t('settings.business.testOk', {
            count: res.toolCount ?? 0,
            tools: tools || '—',
          }),
        );
      } else {
        setError(res.error || t('settings.business.testFailed'));
      }
    } catch {
      setError(t('settings.business.testFailed'));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-2 text-2xl font-semibold tracking-tight">
        {t('settings.business.title')}
      </h1>
      <p className="text-muted-foreground mb-6 text-sm">{t('settings.business.hint')}</p>

      <div className="border-border bg-card space-y-4 rounded-xl border p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium">{t('settings.business.enabled')}</div>
            <div className="text-muted-foreground text-xs">{t('settings.business.enabledHint')}</div>
          </div>
          <SettingsSwitch
            checked={source.enabled}
            onChange={(on) => setSource((s) => ({ ...s, enabled: on }))}
            label={t('settings.business.enabled')}
          />
        </div>

        <div>
          <div className="mb-2 text-sm font-medium">{t('settings.business.serverName')}</div>
          <Input
            value={source.mcpServerName}
            onChange={(e) => setSource((s) => ({ ...s, mcpServerName: e.target.value }))}
            disabled={loading || saving}
          />
        </div>

        <div>
          <div className="mb-2 text-sm font-medium">{t('settings.business.url')}</div>
          <Input
            value={source.url ?? ''}
            placeholder="https://mcp.example.com/mcp"
            onChange={(e) => setSource((s) => ({ ...s, url: e.target.value }))}
            disabled={loading || saving}
          />
        </div>

        <div>
          <div className="mb-2 text-sm font-medium">{t('settings.business.authorization')}</div>
          <p className="text-muted-foreground mb-2 text-xs">
            {source.hasCredential
              ? t('settings.business.authorizationHintSaved')
              : t('settings.business.authorizationHint')}
          </p>
          <Input
            type="password"
            value={authorization}
            placeholder="Bearer …"
            onChange={(e) => setAuthorization(e.target.value)}
            disabled={loading || saving}
            autoComplete="off"
          />
        </div>

        <div>
          <div className="mb-2 text-sm font-medium">{t('settings.business.allowlist')}</div>
          <p className="text-muted-foreground mb-2 text-xs">{t('settings.business.allowlistHint')}</p>
          <Input
            value={allowlistText}
            placeholder="get_order, list_customers"
            onChange={(e) => setAllowlistText(e.target.value)}
            disabled={loading || saving}
          />
        </div>

        <div>
          <div className="mb-2 text-sm font-medium">{t('settings.business.auditWebhook')}</div>
          <p className="text-muted-foreground mb-2 text-xs">{t('settings.business.auditHint')}</p>
          <Input
            value={auditWebhookUrl}
            placeholder="https://siem.example/ingest"
            onChange={(e) => setAuditWebhookUrl(e.target.value)}
            disabled={loading || saving}
            autoComplete="off"
          />
        </div>

        {error && <p className="text-destructive text-sm">{error}</p>}
        {saved && !error && (
          <p className="text-muted-foreground text-sm">{t('settings.business.saved')}</p>
        )}
        {testResult && !error && <p className="text-muted-foreground text-sm">{testResult}</p>}

        <div className="flex gap-2">
          <Button
            type="button"
            className="flex-1"
            onClick={() => void save()}
            disabled={loading || saving || testing}
          >
            {saving ? t('settings.business.saving') : t('settings.business.save')}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={() => void test()}
            disabled={loading || saving || testing}
          >
            {testing ? t('settings.business.testing') : t('settings.business.test')}
          </Button>
        </div>
      </div>
    </div>
  );
}
