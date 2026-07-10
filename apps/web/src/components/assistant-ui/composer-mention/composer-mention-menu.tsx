import { useComposerAddAttachment } from '@assistant-ui/core/react';
import { ChevronRightIcon, FolderIcon, GlobeIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useAui } from '@assistant-ui/store';
import { addComposerFiles } from '@/lib/add-composer-files';
import { pickComposerFiles } from '@/lib/pick-composer-files';
import { useAttachedBrowserTab } from '@/lib/use-composer-settings';
import { usePanelTabs } from '@/components/assistant-ui/right-panel/panel-tabs-context';
import {
  ComposerMenuOption,
  ComposerMenuSection,
  ComposerTriggerMenuShell,
} from './composer-menu-shared';
import { useComposerMenuKeyboard } from './use-composer-menu-keyboard';
import type { MentionTrigger } from './use-composer-mention';

type MentionRow =
  | { kind: 'browser-root' }
  | { kind: 'files' }
  | { kind: 'web-tab'; tabId: string; url: string; label: string };

function browserTabLabel(url: string, fallback: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname + (parsed.pathname !== '/' ? parsed.pathname : '');
  } catch {
    return fallback;
  }
}

export const ComposerMentionMenu: FC<{
  open: boolean;
  trigger: MentionTrigger;
  anchor: { top?: number; bottom?: number; left: number; width: number };
  onClose: () => void;
  onClearTrigger: () => void;
}> = ({ open, trigger, anchor, onClose, onClearTrigger }) => {
  const { t } = useTranslation();
  const aui = useAui();
  const { addAttachment } = useComposerAddAttachment();
  const { tabs, focusWebTab } = usePanelTabs();
  const { setAttachedBrowserTab } = useAttachedBrowserTab();
  const [browserOpen, setBrowserOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const query = trigger.query.toLowerCase();

  const webTabs = useMemo(
    () =>
      tabs
        .filter((tab) => tab.kind === 'web')
        .map((tab) => {
          const url = typeof tab.state?.url === 'string' ? tab.state.url.trim() : '';
          const label = url ? browserTabLabel(url, tab.title) : t('mention.browserEmptyTab');
          return { tab, url, label };
        })
        .filter((entry) => !query || entry.label.toLowerCase().includes(query)),
    [tabs, query, t],
  );

  const rootRows = useMemo((): MentionRow[] => {
    const browserLabel = t('mention.browser').toLowerCase();
    const filesLabel = t('mention.filesFolders').toLowerCase();
    const browserDesc = t('mention.browserDesc').toLowerCase();
    const filesDesc = t('mention.filesFoldersDesc').toLowerCase();

    if (query) {
      const rows: MentionRow[] = [];
      if (
        browserLabel.includes(query) ||
        browserDesc.includes(query) ||
        webTabs.length > 0
      ) {
        rows.push({ kind: 'browser-root' });
      }
      if (filesLabel.includes(query) || filesDesc.includes(query)) {
        rows.push({ kind: 'files' });
      }
      for (const entry of webTabs) {
        rows.push({
          kind: 'web-tab',
          tabId: entry.tab.id,
          url: entry.url,
          label: entry.label,
        });
      }
      return rows;
    }

    return [{ kind: 'browser-root' }, { kind: 'files' }];
  }, [query, webTabs, t]);

  const browserRows = useMemo(
    (): MentionRow[] =>
      webTabs.map((entry) => ({
        kind: 'web-tab' as const,
        tabId: entry.tab.id,
        url: entry.url,
        label: entry.label,
      })),
    [webTabs],
  );

  const flatRows = browserOpen ? browserRows : rootRows;

  useEffect(() => {
    if (!open) {
      setBrowserOpen(false);
      setActiveIndex(0);
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [browserOpen, query]);

  const clearMentionFromInput = useCallback(() => {
    const composer = aui.composer();
    const text = composer.getState().text;
    composer.setText(text.slice(0, trigger.start) + text.slice(trigger.end));
    onClearTrigger();
  }, [aui, trigger, onClearTrigger]);

  const pickFiles = useCallback(() => {
    if (!addAttachment) return;
    clearMentionFromInput();
    onClose();
    void (async () => {
      const files = await pickComposerFiles({ multiple: true });
      if (files.length > 0) {
        await addComposerFiles((file) => addAttachment(file), files);
      }
    })();
  }, [addAttachment, clearMentionFromInput, onClose]);

  const pickWebTab = useCallback(
    async (tabId: string, url: string, title: string) => {
      await focusWebTab(tabId);
      if (url) setAttachedBrowserTab({ tabId, url, title });
      clearMentionFromInput();
      onClose();
    },
    [focusWebTab, setAttachedBrowserTab, clearMentionFromInput, onClose],
  );

  const activateRow = useCallback(
    (index: number) => {
      const row = flatRows[index];
      if (!row) return;

      if (row.kind === 'browser-root') {
        if (webTabs.length === 1 && webTabs[0]?.url) {
          void pickWebTab(webTabs[0].tab.id, webTabs[0].url, webTabs[0].label);
          return;
        }
        setBrowserOpen(true);
        return;
      }
      if (row.kind === 'files') {
        pickFiles();
        return;
      }
      if (row.kind === 'web-tab' && row.url) {
        void pickWebTab(row.tabId, row.url, row.label);
      }
    },
    [flatRows, webTabs, pickWebTab, pickFiles],
  );

  useComposerMenuKeyboard({
    open,
    itemCount: flatRows.length,
    activeIndex,
    setActiveIndex,
    onActivate: activateRow,
    onClose,
    onBack: () => setBrowserOpen(false),
    inSubmenu: browserOpen,
  });

  const renderRow = (row: MentionRow, index: number) => {
    const active = activeIndex === index;

    if (row.kind === 'browser-root') {
      return (
        <ComposerMenuOption
          key="browser-root"
          active={active}
          icon={<GlobeIcon className="size-4" />}
          label={t('mention.browser')}
          description={t('mention.browserDesc')}
          trailing={
            <ChevronRightIcon className="text-muted-foreground mt-1 size-3.5 shrink-0 opacity-60" />
          }
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => activateRow(index)}
        />
      );
    }
    if (row.kind === 'files') {
      return (
        <ComposerMenuOption
          key="files"
          active={active}
          icon={<FolderIcon className="size-4" />}
          label={t('mention.filesFolders')}
          description={t('mention.filesFoldersDesc')}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => activateRow(index)}
        />
      );
    }
    if (row.kind === 'web-tab') {
      return (
        <ComposerMenuOption
          key={`web-${row.tabId}`}
          active={active}
          icon={<GlobeIcon className="size-4" />}
          label={row.label}
          disabled={!row.url}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => activateRow(index)}
        />
      );
    }
    return null;
  };

  const showAttachSection = !query && !browserOpen;

  return (
    <ComposerTriggerMenuShell
      open={open}
      anchor={anchor}
      ariaLabel={t('mention.title')}
      closeLabel={t('mention.close')}
      onClose={onClose}
    >
      {browserOpen && (
        <button
          type="button"
          className="text-muted-foreground hover:bg-accent mb-1 w-full rounded-md px-2.5 py-1.5 text-left text-xs"
          onClick={() => setBrowserOpen(false)}
        >
          ← {t('mention.browser')}
        </button>
      )}

      {flatRows.length === 0 && (
        <p className="text-muted-foreground px-2.5 py-3 text-xs">{t('mention.noMatches')}</p>
      )}

      {showAttachSection ? (
        <>
          <ComposerMenuSection>{t('mention.sectionAttach')}</ComposerMenuSection>
          {rootRows.map((row, index) => renderRow(row, index))}
        </>
      ) : (
        flatRows.map((row, index) => renderRow(row, index))
      )}
    </ComposerTriggerMenuShell>
  );
};
