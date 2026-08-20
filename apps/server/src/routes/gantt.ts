/**
 * 甘特面板的数据代理。面板不直连 Compass:身份(bearer)与项目钉定在这里解析,
 * 与表格同一条(resolveCompassRequestScope)——两条路解析不一致,就会出现
 * "表格看得见、甘特看不见"这种最难查的现象。
 */
import type { FastifyInstance } from 'fastify';
import { fetchCompassData } from '../compass-rest.js';
import { resolveCompassRequestScope } from './tables.js';
import type { ServerDeps } from './types.js';

const VIEWS = new Set(['resource', 'workshop', 'order']);

export function buildGanttQuery(q: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  const view = String(q.view ?? 'resource');
  out.view = VIEWS.has(view) ? view : 'resource';
  for (const k of ['days', 'from_date', 'lane_offset', 'lane_limit', 'bars_per_lane', 'expand']) {
    const v = q[k];
    if (v !== undefined && v !== '') out[k] = String(v);
  }
  return out;
}

export function ganttUnavailableMessage(): string {
  return '这一轮对话没有钉定项目 —— 甘特要先知道看哪个厂的排产。请在输入框上选一个项目。';
}

export function registerGanttRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/api/gantt/window', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const q = req.query as Record<string, unknown>;
    const scope = await resolveCompassRequestScope(
      typeof q.threadId === 'string' ? q.threadId : undefined,
      ctx,
      { getMcpToolsets: deps.getMcpToolsets },
    );
    if (!scope.rest) {
      reply.code(409);
      return { ok: false, message: ganttUnavailableMessage() };
    }
    const r = await fetchCompassData(scope.rest, '/data/gantt-window', buildGanttQuery(q));
    if (!r.ok) {
      reply.code(502);
      return { ok: false, message: r.error };
    }
    return { ok: true, ...r.payload };
  });
}
