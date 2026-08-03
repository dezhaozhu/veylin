import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceCursorBySseBytes,
  cursorToSequenceNum,
} from './stream-resume-cursor';

const enc = new TextEncoder();

test('advanceCursorBySseBytes: one TCP chunk with 3 SSE frames → cursor +3', () => {
  const chunk = enc.encode(
    'data: {"type":"a"}\n\ndata: {"type":"b"}\n\ndata: {"type":"c"}\n\n',
  );
  const result = advanceCursorBySseBytes('', chunk);
  assert.equal(result.cursor, '3');
  assert.equal(result.carry, '');
  assert.equal(cursorToSequenceNum(result.cursor), 3);
});

test('advanceCursorBySseBytes: partial frame across chunks only advances on close', () => {
  const part1 = enc.encode('data: {"type":"a"');
  const mid = advanceCursorBySseBytes('', part1);
  assert.equal(mid.cursor, '');
  assert.equal(mid.carry, 'data: {"type":"a"');

  const part2 = enc.encode('}\n\ndata: {"type":"b"}\n\n');
  const done = advanceCursorBySseBytes(mid.cursor, part2, mid.carry);
  assert.equal(done.cursor, '2');
  assert.equal(done.carry, '');
});

test('advanceCursorBySseBytes: trailing incomplete frame stays in carry', () => {
  const chunk = enc.encode('data: {"type":"a"}\n\ndata: {"partial');
  const result = advanceCursorBySseBytes('1', chunk);
  assert.equal(result.cursor, '2');
  assert.equal(result.carry, 'data: {"partial');
});

test('advanceCursorBySseBytes: empty chunk is a no-op', () => {
  const result = advanceCursorBySseBytes('5', new Uint8Array(), 'leftover');
  assert.equal(result.cursor, '5');
  assert.equal(result.carry, 'leftover');
});

test('advanceCursorBySseBytes: ignores : keepalive comment frames', () => {
  const chunk = enc.encode(
    'data: {"type":"a"}\n\n: keepalive 1\n\ndata: {"type":"b"}\n\n: keepalive 2\n\n',
  );
  const result = advanceCursorBySseBytes('', chunk);
  assert.equal(result.cursor, '2');
  assert.equal(result.carry, '');
});
