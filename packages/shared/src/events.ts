import { z } from 'zod';

/**
 * Streaming protocol between the Mastra runtime and the client.
 * Modeled after the AG-UI event idea: a single ordered event stream
 * that the frontend can render incrementally (text, tools, approvals, plan).
 */

export const agentEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('run-start'), runId: z.string(), threadId: z.string() }),
  z.object({ type: z.literal('text-delta'), messageId: z.string(), delta: z.string() }),
  z.object({ type: z.literal('reasoning-delta'), messageId: z.string(), delta: z.string() }),
  z.object({
    type: z.literal('tool-call'),
    toolCallId: z.string(),
    toolName: z.string(),
    args: z.unknown(),
  }),
  z.object({
    type: z.literal('tool-result'),
    toolCallId: z.string(),
    toolName: z.string(),
    status: z.enum(['completed', 'failed']),
    result: z.unknown(),
  }),
  z.object({
    type: z.literal('approval-required'),
    runId: z.string(),
    toolCallId: z.string(),
    toolName: z.string(),
    reason: z.string(),
    args: z.unknown(),
  }),
  z.object({
    type: z.literal('plan'),
    runId: z.string(),
    steps: z.array(z.object({ title: z.string(), detail: z.string().optional() })),
  }),
  z.object({ type: z.literal('agent-handoff'), from: z.string(), to: z.string(), reason: z.string() }),
  z.object({ type: z.literal('status'), label: z.string() }),
  z.object({ type: z.literal('error'), message: z.string() }),
  z.object({ type: z.literal('run-finish'), runId: z.string(), usage: z.unknown().optional() }),
]);

export type AgentEvent = z.infer<typeof agentEventSchema>;
export type AgentEventType = AgentEvent['type'];
