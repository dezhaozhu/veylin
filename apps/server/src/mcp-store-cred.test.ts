import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withCredentialAuth } from './mcp-store.js';

test('无凭据:headers 原样返回', () => {
  assert.deepEqual(withCredentialAuth({ 'x-a': '1' }, null), { 'x-a': '1' });
});

test('有凭据且行内无 Authorization:合入 Bearer', () => {
  assert.deepEqual(
    withCredentialAuth({ 'x-a': '1' }, { accessToken: 'tok' }),
    { 'x-a': '1', Authorization: 'Bearer tok' },
  );
});

test('行内已有 Authorization(任意大小写):显式配置优先,不覆盖', () => {
  assert.deepEqual(
    withCredentialAuth({ authorization: 'Bearer manual' }, { accessToken: 'tok' }),
    { authorization: 'Bearer manual' },
  );
  assert.deepEqual(
    withCredentialAuth({ Authorization: 'Bearer manual' }, { accessToken: 'tok' }),
    { Authorization: 'Bearer manual' },
  );
});
