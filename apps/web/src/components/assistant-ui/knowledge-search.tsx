import { makeAssistantToolUI } from '@assistant-ui/react';

type KnowledgeReference = {
  refIndex: number;
  chunkId: string;
  documentId: string;
  source: string;
  text: string;
  offset: number;
  score?: number;
};

type KnowledgeSearchResult = {
  references?: KnowledgeReference[];
  context?: string;
};

/**
 * knowledge_search has no inline footprint: citations are surfaced at the bottom
 * of the assistant message (MessageKnowledgeCitations). Standalone registration
 * excludes the tool from generic ToolFallback grouping.
 */
export const KnowledgeSearchToolUI = makeAssistantToolUI<
  { query: string },
  KnowledgeSearchResult
>({
  toolName: 'knowledge_search',
  display: 'standalone',
  render: () => null,
});
