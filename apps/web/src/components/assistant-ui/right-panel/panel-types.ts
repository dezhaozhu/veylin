import type { FC, ReactNode } from 'react';

/** Content type a right-panel tab can host. */
export type PanelKind = 'table' | 'web' | 'rag' | 'workflow' | '3d';

/** A single open tab in the right panel. */
export interface PanelTab {
  id: string;
  kind: PanelKind;
  title: string;
  /** Per-kind state (e.g. a web tab's URL). Persisted with the tab. */
  state?: Record<string, unknown>;
}

/** Props every panel content component receives. */
export interface PanelContentProps {
  tab: PanelTab;
  /** Merge a patch into this tab's persisted state. */
  updateState: (patch: Record<string, unknown>) => void;
}

/**
 * Registry entry describing one panel kind. Adding a new content type only
 * requires registering a new PanelKindDef in panel-registry.tsx.
 */
export interface PanelKindDef {
  kind: PanelKind;
  /** Label shown in the "+" menu. */
  label: string;
  /** Optional hover hint in the "+" menu. */
  description?: string;
  /** Icon for the "+" menu (and optionally the tab). */
  icon: ReactNode;
  /** Default tab title when a new tab of this kind is created. */
  defaultTitle: string;
  /** Optional initial state factory for new tabs of this kind. */
  createState?: () => Record<string, unknown>;
  /** Component rendered in the content area when this tab is active. */
  Component: FC<PanelContentProps>;
}
