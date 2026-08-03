import { minimatch } from 'minimatch';
import { evaluateWebhookFilter } from './webhook-filter';

export function matchesEventKey(eventKey: string, on: string | string[]): boolean {
  const patterns = Array.isArray(on) ? on : [on];
  return patterns.some((pattern) => eventKey === pattern || minimatch(eventKey, pattern));
}

export function matchesEventTrigger(
  trigger: {
    source?: string | null;
    on?: string | string[] | null;
    filter?: string | null;
  },
  eventSource: string,
  eventKey: string,
  payload: Record<string, unknown>,
): boolean {
  if (!trigger.source || trigger.source !== eventSource) return false;
  if (!trigger.on) return false;
  if (!matchesEventKey(eventKey, trigger.on)) return false;
  if (trigger.filter && !evaluateWebhookFilter(trigger.filter, payload)) return false;
  return true;
}
