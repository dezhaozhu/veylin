import { createContext, useContext } from 'react';

export type CollapsiblePanelContextValue = {
  isOpen: boolean;
  isStreaming: boolean;
};

export const CollapsiblePanelContext = createContext<CollapsiblePanelContextValue>({
  isOpen: false,
  isStreaming: false,
});

export function useCollapsiblePanel() {
  return useContext(CollapsiblePanelContext);
}
