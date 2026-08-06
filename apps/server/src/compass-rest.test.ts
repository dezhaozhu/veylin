import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compassRestBase, fetchCompassData } from './compass-rest.js';

test('compassRestBase strips the /mcp/ suffix', () => {
  assert.equal(compassRestBase('http://127.0.0.1:18000/mcp/'), 'http://127.0.0.1:18000');
  assert.equal(compassRestBase('http://10.84.14.37:8000/mcp'), 'http://10.84.14.37:8000');
  assert.equal(compassRestBase('http://h:8000'), 'http://h:8000');
});

test('fetchCompassData composes url+headers and unwraps json object', async () => {
  let seen: { url: string; headers: unknown } | undefined;
  const fetchImpl = (async (url: URL | string, init?: RequestInit) => {
    seen = { url: String(url), headers: init?.headers };
    return new Response(JSON.stringify({ rows: [], total: 0, tenant: 'guolu' }), { status: 200 });
  }) as typeof fetch;
  const r = await fetchCompassData(
    { baseUrl: 'http://h:8000', headers: { Authorization: 'Bearer t', 'x-compass-source': 'guolu' } },
    '/data/schedule-rows',
    { limit: 100, workshop: undefined },
    { fetchImpl },
  );
  assert.ok(r.ok && r.payload['tenant'] === 'guolu');
  assert.equal(seen!.url, 'http://h:8000/data/schedule-rows?limit=100'); // undefined 参数被丢弃
  assert.equal((seen!.headers as Record<string, string>).Authorization, 'Bearer t');
});

test('fetchCompassData surfaces non-200 as ok:false', async () => {
  const fetchImpl = (async () => new Response('nope', { status: 404 })) as typeof fetch;
  const r = await fetchCompassData({ baseUrl: 'http://h', headers: {} }, '/data/schedule-rows', {}, { fetchImpl });
  assert.ok(!r.ok && r.error.includes('404'));
});

test('fetchCompassData surfaces non-object body as ok:false', async () => {
  const fetchImpl = (async () => new Response('[1,2]', { status: 200 })) as typeof fetch;
  const r = await fetchCompassData({ baseUrl: 'http://h', headers: {} }, '/data/schedule-rows', {}, { fetchImpl });
  assert.ok(!r.ok);
});
