import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getPostRetryDelay,
  getStreamReconnectDelay,
  hasStreamFinished,
  isPermanentHttpStatus,
  isPostSuccess,
  postChatWithRetry,
  POST_MAX_RETRIES,
  shouldRetryPost,
  sleepMs,
} from './transport-reconnect';

test('isPermanentHttpStatus matches the agent PERMANENT_HTTP_CODES', () => {
  assert.equal(isPermanentHttpStatus(401), true);
  assert.equal(isPermanentHttpStatus(403), true);
  assert.equal(isPermanentHttpStatus(404), true);
  assert.equal(isPermanentHttpStatus(502), false);
});

test('shouldRetryPost follows the agent POST policy', () => {
  assert.equal(shouldRetryPost(429), true);
  assert.equal(shouldRetryPost(503), true);
  assert.equal(shouldRetryPost(400), false);
  assert.equal(shouldRetryPost(422), false);
});

test('getPostRetryDelay uses capped exponential backoff (500ms–8s)', () => {
  assert.equal(getPostRetryDelay(1), 500);
  assert.equal(getPostRetryDelay(2), 1_000);
  assert.equal(getPostRetryDelay(10), 8_000);
});

test('getStreamReconnectDelay respects 1s base and 30s cap without jitter', () => {
  const d1 = getStreamReconnectDelay(1);
  const d3 = getStreamReconnectDelay(3);
  assert.ok(d1 >= 750 && d1 <= 1_250);
  assert.ok(d3 >= 3_000 && d3 <= 5_000);
});

test('hasStreamFinished detects AI SDK finish marker', () => {
  assert.equal(hasStreamFinished('{"type":"finish"}'), true);
  assert.equal(hasStreamFinished('{"type":"text-delta"}'), false);
});

test('postChatWithRetry retries 503 then succeeds', async () => {
  let calls = 0;
  const delays: number[] = [];

  const response = await postChatWithRetry(
    async () => {
      calls += 1;
      if (calls === 1) return new Response('', { status: 503 });
      return new Response('ok', { status: 200 });
    },
    {
      sleep: async (ms) => {
        delays.push(ms);
      },
    },
  );

  assert.equal(calls, 2);
  assert.equal(isPostSuccess(response.status), true);
  assert.deepEqual(delays, [500]);
});

test('postChatWithRetry does not retry 401', async () => {
  let calls = 0;
  const response = await postChatWithRetry(async () => {
    calls += 1;
    return new Response('denied', { status: 401 });
  });
  assert.equal(calls, 1);
  assert.equal(response.status, 401);
});

test('postChatWithRetry does not retry user abort', async () => {
  let calls = 0;
  const ac = new AbortController();
  ac.abort();

  await assert.rejects(
    postChatWithRetry(
      async () => {
        calls += 1;
        return new Response('ok', { status: 200 });
      },
      { signal: ac.signal, sleep: sleepMs },
    ),
    /Aborted/,
  );
  assert.equal(calls, 0);
});

test('postChatWithRetry exhausts after POST_MAX_RETRIES on network errors', async () => {
  let calls = 0;
  await assert.rejects(
    postChatWithRetry(
      async () => {
        calls += 1;
        throw new TypeError('fetch failed');
      },
      { sleep: async () => {} },
    ),
  );
  assert.equal(calls, POST_MAX_RETRIES);
});
