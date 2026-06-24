#!/usr/bin/env tsx
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

/**
 * Sample industrial MCP server (scheduling domain) authored with the MCP TS SDK.
 * The runtime consumes it via @mastra/mcp. Replace the mock with real ERP/MES calls.
 */
const server = new McpServer({ name: 'veylin-scheduling', version: '0.1.0' });

server.registerTool(
  'get_schedule_risk',
  {
    description: 'Return schedule risk status for a work order (normal | tight | overdue).',
    inputSchema: { orderNo: z.string() },
  },
  async ({ orderNo }) => {
    const buckets = ['normal', 'tight', 'overdue'] as const;
    const status = buckets[orderNo.length % buckets.length];
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ orderNo, status, checkedAt: new Date().toISOString() }),
        },
      ],
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('[mcp:scheduling] failed:', err);
  process.exit(1);
});
