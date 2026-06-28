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
      .optional()
      .describe('Optional hint about what to look for in the page (you summarize after the tool returns)'),
  }),
  outputSchema: z.object({
    bytes: z.number().describe('Size of fetched content in bytes'),
    code: z.number().describe('HTTP status code'),
    codeText: z.string().describe('HTTP status text'),
    content: z.string().describe('Page content as markdown for you to read and summarize'),
    durationMs: z.number().describe('Fetch time in ms'),
    url: z.string().describe('The URL that was requested'),
  }),
  execute: async (input) => runWebFetch(input.url, input.prompt),
});

export { clearWebFetchCache } from './web-fetch/cache';
