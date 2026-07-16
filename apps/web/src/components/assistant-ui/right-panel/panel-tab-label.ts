import { titleFromWebUrl, isUrlLikeTitle } from '@/lib/web-recents';
import type { PanelKind, PanelTab } from './panel-types';

/** Kind → i18n defaultTitle key (avoid importing panel-registry in unit tests). */
const KIND_TITLE_KEY: Record<PanelKind, string> = {
  table: 'panels.table.label',
  web: 'panels.web.label',
  rag: 'panels.rag.label',
  workflow: 'panels.workflow.label',
};

/**
 * Top-bar label for a kind tab.
 * - table / rag / workflow: kind name (二级在面板内)
 * - web: page title or hostname when available, else kind name
 */
export function getPanelTabDisplayLabel(
  tab: PanelTab,
  t: (key: string) => string,
): string {
  const kindLabel = t(KIND_TITLE_KEY[tab.kind] ?? tab.title);

  if (tab.kind === 'web') {
    const url = typeof tab.state?.url === 'string' ? tab.state.url.trim() : '';
    const pageTitle = typeof tab.state?.title === 'string' ? tab.state.title.trim() : '';
    if (pageTitle && url && !isUrlLikeTitle(pageTitle, url)) return pageTitle;
    if (pageTitle && !url) return pageTitle;
    if (url) {
      try {
        return new URL(url).hostname || titleFromWebUrl(url);
      } catch {
        return titleFromWebUrl(url);
      }
    }
  }

  return kindLabel;
}

export function panelKindOpenSet(tabs: PanelTab[]): Set<PanelKind> {
  return new Set(tabs.map((t) => t.kind));
}
