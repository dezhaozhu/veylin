/**
 * 不可变原件仓(spec 2026-08-14 §3、§8 的 1/2/3/7 条)。
 *
 * **导入即留档**:任何文件进来都先按内容哈希存一份、只读、从此不动。于是
 *   - 同一文件导两次 = 同一 hash = 一份原件
 *   - 改过再导 = 新 hash = 新版本,两份都在
 *   - 外面把副本改了 = 哈希对不上 = 它已经是另一个东西(不必监听 mtime)
 *
 * 原件按原样存**文件**、不塞进嵌入式库:取回自己的东西不该依赖我们的应用还能跑。
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  storeOriginal,
  readManifest,
  verifyOriginal,
  originalPath,
} from './project-originals.js';

let folder: string;
beforeEach(() => { folder = mkdtempSync(join(tmpdir(), 'veylin-proj-')); });
afterEach(() => { rmSync(folder, { recursive: true, force: true }); });

const bytes = (s: string) => Buffer.from(s, 'utf8');

describe('storeOriginal', () => {
  it('第一次导入:写进 .veylin/originals,内容一字不差', async () => {
    const rec = await storeOriginal(folder, '三级计划.xlsx', bytes('hello'), '/Users/me/Downloads/三级计划.xlsx');
    assert.equal(rec.name, '三级计划.xlsx');
    assert.match(rec.hash, /^[0-9a-f]{64}$/);
    assert.equal(rec.alreadyPresent, false);
    assert.equal(readFileSync(originalPath(folder, rec.hash, rec.name), 'utf8'), 'hello');
    assert.equal(rec.fromPath, '/Users/me/Downloads/三级计划.xlsx');
  });

  it('同一文件导两次 = 一份原件,但记下"又见到一次"', async () => {
    const a = await storeOriginal(folder, 'x.xlsx', bytes('same'));
    const b = await storeOriginal(folder, 'x.xlsx', bytes('same'));
    assert.equal(a.hash, b.hash);
    assert.equal(b.alreadyPresent, true, '第二次不该重复存');

    const m = await readManifest(folder);
    assert.equal(m.originals.length, 1, '仓里只有一份');
    assert.equal(m.originals[0]!.seenCount, 2, '但见过两次');
  });

  it('改一个字节再导 = 新版本,两份都在', async () => {
    const v1 = await storeOriginal(folder, 'x.xlsx', bytes('v1'));
    const v2 = await storeOriginal(folder, 'x.xlsx', bytes('v2'));
    assert.notEqual(v1.hash, v2.hash);

    const m = await readManifest(folder);
    assert.equal(m.originals.length, 2);
    assert.equal(readFileSync(originalPath(folder, v1.hash, 'x.xlsx'), 'utf8'), 'v1', '旧版本还在');
    assert.equal(readFileSync(originalPath(folder, v2.hash, 'x.xlsx'), 'utf8'), 'v2');
  });

  it('原件是只读的 —— 防手滑(真正的保证是哈希)', async () => {
    const rec = await storeOriginal(folder, 'x.xlsx', bytes('ro'));
    const mode = statSync(originalPath(folder, rec.hash, rec.name)).mode & 0o222;
    assert.equal(mode, 0, '不该有任何写位');
  });

  it('文件名里的路径分隔符不会逃出仓外', async () => {
    const rec = await storeOriginal(folder, '../../etc/passwd', bytes('nope'));
    assert.ok(originalPath(folder, rec.hash, rec.name).startsWith(join(folder, '.veylin', 'originals')));
    assert.ok(!existsSync(join(folder, '..', '..', 'etc', 'passwd')));
  });
});

describe('verifyOriginal —— 只认哈希,不监听文件', () => {
  it('原样在那儿 → ok', async () => {
    const rec = await storeOriginal(folder, 'x.xlsx', bytes('keep'));
    assert.equal((await verifyOriginal(folder, rec.hash, rec.name)).status, 'ok');
  });

  it('被外面改了 → modified,明说它已经不是当初那份', async () => {
    const rec = await storeOriginal(folder, 'x.xlsx', bytes('keep'));
    const p = originalPath(folder, rec.hash, rec.name);
    chmodSync(p, 0o644);                     // 只读位挡得住手滑,挡不住存心改
    writeFileSync(p, 'tampered');
    const v = await verifyOriginal(folder, rec.hash, rec.name);
    assert.equal(v.status, 'modified');
    assert.match(v.detail ?? '', /不是当初/);
  });

  it('整个文件夹被移走 → missing,而不是假装还在(§8.7)', async () => {
    const rec = await storeOriginal(folder, 'x.xlsx', bytes('gone'));
    rmSync(join(folder, '.veylin'), { recursive: true, force: true });
    const v = await verifyOriginal(folder, rec.hash, rec.name);
    assert.equal(v.status, 'missing');
  });
});

describe('manifest', () => {
  it('记下了名字、哈希、什么时候进来的、从哪儿来的', async () => {
    await storeOriginal(folder, 'a.xlsx', bytes('a'), '/tmp/a.xlsx');
    const m = await readManifest(folder);
    const rec = m.originals[0]!;
    assert.equal(rec.name, 'a.xlsx');
    assert.equal(rec.fromPath, '/tmp/a.xlsx');
    assert.match(rec.importedAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  it('没有 .veylin 的文件夹读出来是空的,不报错', async () => {
    const m = await readManifest(folder);
    assert.deepEqual(m.originals, []);
  });
});
