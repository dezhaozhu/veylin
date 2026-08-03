import type { FastifyInstance } from 'fastify';
import {
  DEFAULT_GOAL_MAX_TURNS,
  LOOP_WAKEUP_MIN_SECONDS,
  isGoalActive,
  isLoopActive,
  parseIntervalToSeconds,
  type ThreadGoalState,
  type ThreadLoopState,
} from '@veylin/shared';
import type { ServerDeps } from './types.js';
import {
  createActiveGoal,
  createActiveLoop,
  ensureThreadState,
  getThreadState,
  resolveThreadForRead,
  setThreadGoal,
  setThreadLoop,
} from '../thread-state.js';
import { clearLoopTimer, rescheduleLoopFromState } from '../loop-scheduler.js';

type GoalBody = {
  threadId?: string;
  action?: 'set' | 'clear' | 'get' | 'ack-continue';
  condition?: string;
  maxTurns?: number;
};

type LoopBody = {
  threadId?: string;
  action?: 'set' | 'stop' | 'get' | 'ack-wake';
  prompt?: string;
  intervalSeconds?: number;
  interval?: string;
  mode?: 'fixed' | 'dynamic';
};

export function registerGoalLoopRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/api/goal', async (req) => {
    const { threadId } = req.query as { threadId?: string };
    if (!threadId) return { goal: null };
    const ctx = await deps.resolveContext(req.headers);
    const row = await resolveThreadForRead(threadId, ctx);
    return { goal: row?.goal ?? null };
  });

  app.post('/api/goal', async (req, reply) => {
    const body = req.body as GoalBody;
    const ctx = await deps.resolveContext(req.headers);
    if (!body.threadId) return reply.status(400).send({ error: 'threadId required' });

    await ensureThreadState({
      threadId: body.threadId,
      tenantId: ctx.tenantId,
      resourceId: ctx.userId,
    });
    const state = await getThreadState(body.threadId);
    const action = body.action ?? 'get';

    if (action === 'get') {
      return { ok: true, goal: state?.goal ?? null };
    }

    if (action === 'clear') {
      const prev = state?.goal;
      if (prev && prev.status === 'active') {
        const cleared: ThreadGoalState = {
          ...prev,
          status: 'cleared',
          needsContinuation: false,
          updatedAt: new Date().toISOString(),
        };
        await setThreadGoal(body.threadId, cleared);
        // Client treats null as "no active goal" for the chip.
        return { ok: true, goal: null };
      }
      await setThreadGoal(body.threadId, null);
      return { ok: true, goal: null };
    }

    if (action === 'ack-continue') {
      const goal = state?.goal;
      if (!goal || goal.status !== 'active') return { ok: true, goal: goal ?? null };
      const next = { ...goal, needsContinuation: false, updatedAt: new Date().toISOString() };
      await setThreadGoal(body.threadId, next);
      return { ok: true, goal: next };
    }

    if (action === 'set') {
      const condition = body.condition?.trim() ?? '';
      if (!condition) return reply.status(400).send({ error: 'condition required' });
      if (isLoopActive(state?.loop)) {
        return reply.status(409).send({
          error: 'loop_active',
          message: 'Stop the active loop before setting a goal.',
        });
      }
      const goal = createActiveGoal(condition, body.maxTurns ?? DEFAULT_GOAL_MAX_TURNS);
      await setThreadGoal(body.threadId, goal);
      return { ok: true, goal, start: true };
    }

    return reply.status(400).send({ error: 'unknown action' });
  });

  app.get('/api/loop', async (req) => {
    const { threadId } = req.query as { threadId?: string };
    if (!threadId) return { loop: null };
    const ctx = await deps.resolveContext(req.headers);
    const row = await resolveThreadForRead(threadId, ctx);
    return { loop: row?.loop ?? null };
  });

  app.post('/api/loop', async (req, reply) => {
    const body = req.body as LoopBody;
    const ctx = await deps.resolveContext(req.headers);
    if (!body.threadId) return reply.status(400).send({ error: 'threadId required' });

    await ensureThreadState({
      threadId: body.threadId,
      tenantId: ctx.tenantId,
      resourceId: ctx.userId,
    });
    const state = await getThreadState(body.threadId);
    const action = body.action ?? 'get';

    if (action === 'get') {
      return { ok: true, loop: state?.loop ?? null };
    }

    if (action === 'stop') {
      clearLoopTimer(body.threadId);
      const prev = state?.loop;
      if (prev) {
        const stopped: ThreadLoopState = {
          ...prev,
          status: 'stopped',
          nextWakeAt: undefined,
        };
        await setThreadLoop(body.threadId, stopped);
        return { ok: true, loop: stopped };
      }
      await setThreadLoop(body.threadId, null);
      return { ok: true, loop: null };
    }

    if (action === 'ack-wake') {
      const loop = state?.loop;
      if (!loop || loop.status !== 'active') return { ok: true, loop: loop ?? null };
      const now = Date.now();
      let nextWakeAt: string | undefined;
      if (loop.mode === 'fixed' && loop.intervalSeconds) {
        nextWakeAt = new Date(now + loop.intervalSeconds * 1000).toISOString();
      }
      const next: ThreadLoopState = { ...loop, nextWakeAt };
      await setThreadLoop(body.threadId, next);
      rescheduleLoopFromState(body.threadId, next);
      return { ok: true, loop: next };
    }

    if (action === 'set') {
      const prompt = body.prompt?.trim() ?? '';
      if (!prompt) return reply.status(400).send({ error: 'prompt required' });
      if (isGoalActive(state?.goal)) {
        return reply.status(409).send({
          error: 'goal_active',
          message: 'Clear the active goal before starting a loop.',
        });
      }

      let intervalSeconds = body.intervalSeconds;
      if (intervalSeconds == null && body.interval) {
        intervalSeconds = parseIntervalToSeconds(body.interval) ?? undefined;
      }
      const mode: ThreadLoopState['mode'] =
        body.mode ?? (intervalSeconds != null ? 'fixed' : 'dynamic');
      if (mode === 'fixed' && (intervalSeconds == null || intervalSeconds < LOOP_WAKEUP_MIN_SECONDS)) {
        return reply.status(400).send({
          error: 'interval required for fixed loop',
          message: `Fixed loop interval must be at least ${LOOP_WAKEUP_MIN_SECONDS}s.`,
        });
      }

      clearLoopTimer(body.threadId);
      const loop = createActiveLoop({
        prompt,
        mode,
        intervalSeconds: mode === 'fixed' ? intervalSeconds : undefined,
      });
      // First run is immediate (client); schedule subsequent wake after first finish.
      if (mode === 'fixed' && intervalSeconds) {
        loop.nextWakeAt = undefined;
      }
      await setThreadLoop(body.threadId, loop);
      return { ok: true, loop, start: true };
    }

    return reply.status(400).send({ error: 'unknown action' });
  });
}
