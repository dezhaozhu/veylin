import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { runWebFetch } from './web-fetch/fetch-content';
import { WEB_FETCH_AUTH_WARNING, WEB_FETCH_DESCRIPTION } from './web-fetch/prompt';

export const webFetch = createTool({
  id: 'web_fetch',
  description: `${WEB_FETCH_AUTH_WARNING}\n${WEB_FETCH_DESCRIPTION}`,
  inputSchema: z.object({
    url: z.string().url().describe('The URL to fetch content from'),
    prompt: z
      .string()
      .describe('What to extract or analyze from the page (passed to a small model)'),
  }),
  outputSchema: z.object({
    bytes: z.number().describe('Size of fetched content in bytes'),
    code: z.number().describe('HTTP status code'),
    codeText: z.string().describe('HTTP status text'),
    result: z.string().describe('Processed result from applying the prompt to the content'),
    durationMs: z.number().describe('Fetch + processing time in ms'),
    url: z.string().describe('The URL that was requested'),
  }),
  execute: async (input) => runWebFetch(input.url, input.prompt),
});

export { clearWebFetchCache } from './web-fetch/cache';
