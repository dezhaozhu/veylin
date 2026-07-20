import type { TFunction } from 'i18next';

export type WorkspaceView = 'chat' | 'customize' | 'automate' | 'settings';
export type CustomizeTab = 'skills' | 'rules' | 'mcp' | 'hooks' | 'plugins';
export type SettingsTab = 'general' | 'models' | 'business';

export type WorkspaceLocation =
  | { view: 'chat'; threadId: string; threadTitle?: string }
  | { view: 'customize'; tab: CustomizeTab }
  | { view: 'automate' }
  | { view: 'settings'; tab: SettingsTab };

export type NavState = {
  entries: WorkspaceLocation[];
  index: number;
};

export const MAX_NAV_ENTRIES = 50;
const STORAGE_KEY = 'veylin:workspace-nav';

export const EMPTY_NAV: NavState = { entries: [], index: -1 };

export function locationKey(loc: WorkspaceLocation): string {
  switch (loc.view) {
    case 'chat':
      return `chat:${loc.threadId}`;
    case 'customize':
      return `customize:${loc.tab}`;
    case 'automate':
      return 'automate';
    case 'settings':
      return `settings:${loc.tab}`;
  }
}

export function locationsEqual(a: WorkspaceLocation, b: WorkspaceLocation): boolean {
  return locationKey(a) === locationKey(b);
}

export function pushLocation(nav: NavState, loc: WorkspaceLocation): NavState {
  if (nav.index >= 0 && locationsEqual(nav.entries[nav.index]!, loc)) {
    return nav;
  }

  const base = nav.index >= 0 ? nav.entries.slice(0, nav.index + 1) : [];
  const entries = [...base, loc].slice(-MAX_NAV_ENTRIES);
  return { entries, index: entries.length - 1 };
}

export function reconcileNav(nav: NavState, current: WorkspaceLocation): NavState {
  if (nav.entries.length === 0) {
    return { entries: [current], index: 0 };
  }

  const existingIdx = nav.entries.findIndex((entry) => locationsEqual(entry, current));
  if (existingIdx >= 0) {
    return { ...nav, index: existingIdx };
  }

  return pushLocation({ ...nav, index: Math.max(nav.index, 0) }, current);
}

export function loadNavState(): NavState {
  if (typeof sessionStorage === 'undefined') return EMPTY_NAV;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_NAV;
    const parsed = JSON.parse(raw) as NavState;
    if (!Array.isArray(parsed.entries) || typeof parsed.index !== 'number') {
      return EMPTY_NAV;
    }
    const entries = parsed.entries.slice(-MAX_NAV_ENTRIES);
    const index = Math.min(Math.max(parsed.index, -1), entries.length - 1);
    return { entries, index };
  } catch {
    return EMPTY_NAV;
  }
}

export function saveNavState(nav: NavState): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(nav));
  } catch {
    // Quota or private mode — navigation still works for the session.
  }
}

export function getLocationLabel(loc: WorkspaceLocation, t: TFunction): string {
  switch (loc.view) {
    case 'chat':
      return loc.threadTitle?.trim() || t('header.newChat');
    case 'customize':
      return `${t('customize.title')} · ${t(`customize.${loc.tab}`)}`;
    case 'automate':
      return t('automate.title');
    case 'settings':
      return `${t('settings.navTitle')} · ${t(`settings.${loc.tab}.nav`)}`;
  }
}

export function buildWorkspaceLocation(input: {
  view: WorkspaceView;
  customizeTab: CustomizeTab;
  settingsTab: SettingsTab;
  threadId?: string;
  threadTitle?: string | null;
}): WorkspaceLocation | null {
  switch (input.view) {
    case 'chat':
      if (!input.threadId) return null;
      return {
        view: 'chat',
        threadId: input.threadId,
        threadTitle: input.threadTitle?.trim() || undefined,
      };
    case 'customize':
      return { view: 'customize', tab: input.customizeTab };
    case 'automate':
      return { view: 'automate' };
    case 'settings':
      return { view: 'settings', tab: input.settingsTab };
  }
}
