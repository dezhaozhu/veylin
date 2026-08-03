import { GlobeIcon } from 'lucide-react';
import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { ComposerRefChip } from '@/components/assistant-ui/composer-mention/composer-ref-chip';
import { useAttachedBrowserTab } from '@/lib/use-composer-settings';

function browserTypeLabel(url: string): string {
  try {
    const host = new URL(url).hostname;
    return host.split('.').pop()?.toUpperCase() ?? 'WEB';
  } catch {
    return 'WEB';
  }
}

export const ComposerBrowserRefChip: FC = () => {
  const { t } = useTranslation();
  const { attachedBrowserTab, setAttachedBrowserTab } = useAttachedBrowserTab();

  if (!attachedBrowserTab) return null;

  const displayName = attachedBrowserTab.title || attachedBrowserTab.url;

  return (
    <ComposerRefChip
      icon={<GlobeIcon className="text-muted-foreground size-5" aria-hidden />}
      title={displayName}
      subtitle={browserTypeLabel(attachedBrowserTab.url)}
      chipAriaLabel={t('mention.browserChip', { name: displayName })}
      removeAriaLabel={t('mention.removeBrowser')}
      onRemove={() => setAttachedBrowserTab(null)}
    />
  );
};
