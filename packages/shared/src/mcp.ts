import { z } from 'zod';

export const mcpTransportSchema = z.enum(['sse', 'http']);
export type McpTransport = z.infer<typeof mcpTransportSchema>;

export const mcpServerSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  name: z.string(),
  transport: mcpTransportSchema,
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).default({}),
  enabled: z.boolean(),
  createdAt: z.string().optional(),
});

export type McpServer = z.infer<typeof mcpServerSchema>;

export const mcpServerInputSchema = z.object({
  name: z.string().min(1),
  transport: mcpTransportSchema,
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).default({}),
  enabled: z.boolean().default(true),
});

export type McpServerInput = z.infer<typeof mcpServerInputSchema>;

export const bundledMcpServerSchema = z.object({
  name: z.string(),
  bundled: z.literal(true),
});

export type BundledMcpServer = z.infer<typeof bundledMcpServerSchema>;
