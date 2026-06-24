#!/usr/bin/env tsx
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

/**
 * Sample industrial MCP server (equipment maintenance domain). Demonstrates a
 * second domain server so agents can declare which servers they need via
 * agent.yaml `mcpServers`. Replace mocks with real CMMS/IoT calls.
 */
const server = new McpServer({ name: 'veylin-maintenance', version: '0.1.0' });

server.registerTool(
  'get_equipment_status',
  {
    description: 'Return health status for a machine (ok | degraded | down) and last service date.',
    inputSchema: { machineId: z.string() },
  },
  async ({ machineId }) => {
    const buckets = ['ok', 'degraded', 'down'] as const;
    const status = buckets[machineId.length % buckets.length];
    const lastService = new Date(Date.now() - (machineId.length % 30) * 86400000)
      .toISOString()
      .slice(0, 10);
    return {
      content: [{ type: 'text', text: JSON.stringify({ machineId, status, lastService }) }],
    };
  },
);

server.registerTool(
  'list_open_work_orders',
  {
    description: 'List open maintenance work orders for a production line.',
    inputSchema: { line: z.string() },
  },
  async ({ line }) => {
    const count = (line.length % 3) + 1;
    const orders = Array.from({ length: count }, (_, i) => ({
      id: `WO-${line}-${i + 1}`,
      priority: (['low', 'medium', 'high'] as const)[i % 3],
    }));
    return { content: [{ type: 'text', text: JSON.stringify({ line, orders }) }] };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('[mcp:maintenance] failed:', err);
  process.exit(1);
});
