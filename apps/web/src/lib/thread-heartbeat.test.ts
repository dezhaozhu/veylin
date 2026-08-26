import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  GOAL_LOOP_ACTIVE_MS,
  GOAL_LOOP_EMPTY_MS,
  GOAL_LOOP_RUNNING_MS,
  isServerThreadId,
  nextGoalLoopDelay,
} from './thread-heartbeat';

describe('isServerThreadId', () => {
  it('本地草稿不算', () => {
    assert.equal(isServerThreadId('_LOCALID_Wu8vCGc'), false);
    assert.equal(isServerThreadId('__LOCALID_abc'), false);
    assert.equal(isServerThreadId(undefined), false);
    assert.equal(isServerThreadId(''), false);
  });

  it('服务端发的 id 算', () => {
    assert.equal(isServerThreadId('th_abc123'), true);
  });
});

describe('nextGoalLoopDelay', () => {
  it('页藏着 → 停', () => {
    assert.equal(
      nextGoalLoopDelay({
        visible: false,
        chatRunning: true,
        goalActive: true,
        loopActive: true,
      }),
      null,
    );
  });

  it('对话在跑 → 1.5s', () => {
    assert.equal(
      nextGoalLoopDelay({
        visible: true,
        chatRunning: true,
        goalActive: false,
        loopActive: false,
      }),
      GOAL_LOOP_RUNNING_MS,
    );
  });

  it('有目标或循环 → 2s', () => {
    assert.equal(
      nextGoalLoopDelay({
        visible: true,
        chatRunning: false,
        goalActive: true,
        loopActive: false,
      }),
      GOAL_LOOP_ACTIVE_MS,
    );
  });

  it('什么都没有 → 30s,不再 2s 空转', () => {
    assert.equal(
      nextGoalLoopDelay({
        visible: true,
        chatRunning: false,
        goalActive: false,
        loopActive: false,
      }),
      GOAL_LOOP_EMPTY_MS,
    );
  });
});
