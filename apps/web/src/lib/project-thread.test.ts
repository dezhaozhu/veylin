import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { pickProjectThread } from './project-thread';

const at = (iso: string) => new Date(iso);

describe('pickProjectThread', () => {
  const map = { 'r-a': 'p1', 'r-b': 'p1', 'r-c': 'p2' };

  it('落回本项目最近说过话的那条', () => {
    const got = pickProjectThread(
      [
        { id: 'a', remoteId: 'r-a', lastMessageAt: at('2026-08-17T00:00:00Z') },
        { id: 'b', remoteId: 'r-b', lastMessageAt: at('2026-08-18T00:00:00Z') },
        { id: 'c', remoteId: 'r-c', lastMessageAt: at('2026-08-18T09:00:00Z') },
      ],
      map,
      'p1',
    );
    assert.equal(got, 'b');
  });

  it('别的项目的对话再新也不选 —— 这正是用户踩的那个坑', () => {
    const got = pickProjectThread(
      [{ id: 'c', remoteId: 'r-c', lastMessageAt: at('2026-08-18T09:00:00Z') }],
      map,
      'p1',
    );
    assert.equal(got, null);
  });

  it('还没说过话的空线程排最后', () => {
    const got = pickProjectThread(
      [
        { id: 'empty', remoteId: 'r-b' },
        { id: 'a', remoteId: 'r-a', lastMessageAt: at('2026-08-17T00:00:00Z') },
      ],
      map,
      'p1',
    );
    assert.equal(got, 'a');
  });

  it('新线程还没有 remoteId 时用本地 id 认领', () => {
    const got = pickProjectThread([{ id: 'local-1' }], { 'local-1': 'p1' }, 'p1');
    assert.equal(got, 'local-1');
  });
});
