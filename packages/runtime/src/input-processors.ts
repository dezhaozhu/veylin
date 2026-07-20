import type { ModelKey } from './models';
import { buildSummarizer } from './summarizer';
import { ContextCompression } from './processors/contextCompression';
import { ToolResultMicrocompact } from './processors/toolResultMicrocompact';
import { TokenLimiter } from '@mastra/core/processors';
import { inputTokenLimit } from './token-limit';

/** Standard processor chain: microcompact → compaction → token limit. */
export function buildInputProcessors(modelKey: ModelKey = 'default') {
  return [
    new ToolResultMicrocompact(),
    new ContextCompression({
      summarizer: buildSummarizer(modelKey),
      modelKey,
    }),
    new TokenLimiter({ limit: inputTokenLimit(modelKey) }),
  ];
}
