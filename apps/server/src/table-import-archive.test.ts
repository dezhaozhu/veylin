/**
 * 导入即留档(spec 2026-08-14 §3)。
 *
 * 导入接口收到解析后的行**和原件字节**:字节先按内容哈希留档进项目文件夹,再把
 * 「来自哪份文件」写成 sheet 的来源指针。没有绑文件夹、或不在项目里,就照实说
 * 一句"没留档",而不是假装留了。
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archiveImportedFile } from './table-import-archive.js';
import { originalPath, readManifest } from './project-originals.js';

let folder: string;
beforeEach(() => { folder = mkdtempSync(join(tmpdir(), 'veylin-imp-')); });
afterEach(() => { rmSync(folder, { recursive: true, force: true }); });

const file = { name: '三级计划.xlsx', base64: Buffer.from('xlsx-bytes').toString('base64') };

describe('archiveImportedFile', () => {
  it('有文件夹:原件留档 + 给出 file 来源指针', async () => {
    const out = await archiveImportedFile({ folder, projectId: 'p-1', file });
    assert.equal(out.archived, true);
    assert.equal(out.source?.kind, 'file');
    assert.equal(out.source?.fileName, '三级计划.xlsx');
    assert.equal(out.source?.project, 'p-1');
    assert.match(out.source!.fileHash, /^[0-9a-f]{64}$/);
    assert.equal(
      readFileSync(originalPath(folder, out.source!.fileHash, '三级计划.xlsx'), 'utf8'),
      'xlsx-bytes',
    );
    assert.equal((await readManifest(folder)).originals.length, 1);
  });

  it('没绑文件夹:照常导入,但**说清楚没留档**,不假装', async () => {
    const out = await archiveImportedFile({ folder: undefined, projectId: 'p-1', file });
    assert.equal(out.archived, false);
    assert.equal(out.source, undefined);
    assert.match(out.reason ?? '', /没有绑定文件夹/);
  });

  it('没有原件字节(agent 直接送行、或老前端):同样照实说', async () => {
    const out = await archiveImportedFile({ folder, projectId: 'p-1', file: undefined });
    assert.equal(out.archived, false);
    assert.match(out.reason ?? '', /没有原件/);
  });

  it('文件夹被移走:不静默吞掉,报出来', async () => {
    rmSync(folder, { recursive: true, force: true });
    const out = await archiveImportedFile({ folder, projectId: 'p-1', file });
    assert.equal(out.archived, false);
    assert.match(out.reason ?? '', /不存在/);
  });

  it('同一份文件再导一次:只有一份原件,指针指向同一个哈希', async () => {
    const a = await archiveImportedFile({ folder, projectId: 'p-1', file });
    const b = await archiveImportedFile({ folder, projectId: 'p-1', file });
    assert.equal(a.source!.fileHash, b.source!.fileHash);
    assert.equal((await readManifest(folder)).originals.length, 1);
  });

  it('改一个字节:新哈希,指针跟着换到新版本,旧的仍在', async () => {
    const v1 = await archiveImportedFile({ folder, projectId: 'p-1', file });
    const v2 = await archiveImportedFile({
      folder, projectId: 'p-1',
      file: { name: file.name, base64: Buffer.from('xlsx-bytes-v2').toString('base64') },
    });
    assert.notEqual(v1.source!.fileHash, v2.source!.fileHash);
    assert.equal((await readManifest(folder)).originals.length, 2);
    assert.ok(readFileSync(originalPath(folder, v1.source!.fileHash, file.name), 'utf8'));
  });
});
