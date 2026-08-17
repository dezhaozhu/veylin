/**
 * 不可变原件仓 —— spec: docs/specs/2026-08-14-project-folder-immutable-originals.md
 *
 * **导入即留档**:任何文件进项目都先按内容哈希存一份、设只读、从此不动。库里只放
 * 解析结果和一根指向这里的指针。
 *
 * 为什么按原样存**文件**而不塞进嵌入式库:取回自己的东西不该依赖我们的应用还能跑。
 * 库损坏、schema 变了、应用装不上 —— 原件都得能在 Finder 里双击打开。
 *
 * 为什么**不监听文件**(fs.watch / mtime):我们只认哈希。外面把副本改了,哈希对不上,
 * 它就已经是另一个东西 —— 不存在"改了但我们以为没改"的中间态。
 */
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';

/** 一份进过项目的原件。写下就不改(seenCount 除外 —— 那是"又见到一次")。 */
export type OriginalRecord = {
  hash: string;
  name: string;
  bytes: number;
  importedAt: string;
  /** 它当初躺在哪儿(下载目录、桌面…)。纯溯源,不用于读取。 */
  fromPath?: string;
  seenCount: number;
};

export type ProjectManifest = { version: 1; originals: OriginalRecord[] };

const VEYLIN_DIR = '.veylin';
const ORIGINALS = 'originals';
const MANIFEST = 'manifest.json';
/** 目录名只取哈希前 12 位:够分辨,又不至于让路径难读。 */
const DIR_HASH_LEN = 12;

const veylinDir = (folder: string) => join(folder, VEYLIN_DIR);
const manifestPath = (folder: string) => join(veylinDir(folder), MANIFEST);

/** 文件名只取 basename —— `../../etc/passwd` 这种不能逃出仓外。 */
export function safeName(name: string): string {
  const base = basename(String(name || '').split(/[\\/]/).pop() ?? '');
  return base && base !== '.' && base !== '..' ? base : 'unnamed';
}

export function originalPath(folder: string, hash: string, name: string): string {
  return join(veylinDir(folder), ORIGINALS, hash.slice(0, DIR_HASH_LEN), safeName(name));
}

export function sha256(bytes: Buffer | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function readManifest(folder: string): Promise<ProjectManifest> {
  try {
    const raw = await readFile(manifestPath(folder), 'utf8');
    const parsed = JSON.parse(raw) as ProjectManifest;
    return { version: 1, originals: Array.isArray(parsed.originals) ? parsed.originals : [] };
  } catch {
    // 没有 .veylin 或读不出来 = 这个文件夹还没被用作项目。空,不报错。
    return { version: 1, originals: [] };
  }
}

async function writeManifest(folder: string, m: ProjectManifest): Promise<void> {
  await mkdir(veylinDir(folder), { recursive: true });
  await writeFile(manifestPath(folder), JSON.stringify(m, null, 2), 'utf8');
}

/**
 * 把一份文件留档。同内容重复导入不重复存,只把 `seenCount` 加一 —— "又见到一次"
 * 本身是有用的信息(它说明这份东西被反复用到),但不该变成第二份副本。
 */
export async function storeOriginal(
  folder: string,
  name: string,
  bytes: Buffer,
  fromPath?: string,
): Promise<OriginalRecord & { alreadyPresent: boolean; path: string }> {
  const hash = sha256(bytes);
  const clean = safeName(name);
  const target = originalPath(folder, hash, clean);

  const manifest = await readManifest(folder);
  const existing = manifest.originals.find((o) => o.hash === hash && o.name === clean);

  if (!existing) {
    await mkdir(join(veylinDir(folder), ORIGINALS, hash.slice(0, DIR_HASH_LEN)), { recursive: true });
    await writeFile(target, bytes);
    await chmod(target, 0o444);          // 防手滑;真正的保证是哈希
  }

  const rec: OriginalRecord = existing
    ? { ...existing, seenCount: existing.seenCount + 1 }
    : {
        hash,
        name: clean,
        bytes: bytes.length,
        importedAt: new Date().toISOString(),
        ...(fromPath ? { fromPath } : {}),
        seenCount: 1,
      };

  manifest.originals = [...manifest.originals.filter((o) => !(o.hash === hash && o.name === clean)), rec];
  await writeManifest(folder, manifest);

  return { ...rec, alreadyPresent: Boolean(existing), path: target };
}

export type VerifyResult = { status: 'ok' | 'modified' | 'missing'; detail?: string };

/**
 * 这份原件还是当初那份吗。**只算哈希**,不看 mtime、不监听。
 *
 * `missing` 与 `modified` 要分开说:前者是文件夹被移走/删了(溯源断了),后者是
 * 有人在外面改了它 —— 两种都不能假装没事,但下一步动作不同。
 */
export async function verifyOriginal(
  folder: string,
  hash: string,
  name: string,
): Promise<VerifyResult> {
  const p = originalPath(folder, hash, name);
  try {
    await stat(p);
  } catch {
    return { status: 'missing', detail: `原件不在了(${p}) —— 溯源断了,不要当它还在` };
  }
  const actual = sha256(await readFile(p));
  if (actual !== hash) {
    return { status: 'modified', detail: '文件内容与哈希对不上 —— 它已经不是当初那一份了' };
  }
  return { status: 'ok' };
}

/** 项目文件夹是不是在(移走/删掉要明说,不能假装原件还在)。 */
export async function folderExists(folder: string): Promise<boolean> {
  try {
    return (await stat(folder)).isDirectory();
  } catch {
    return false;
  }
}

/** 给出仓的绝对根,便于日志与错误信息里说清楚东西在哪。 */
export function originalsRoot(folder: string): string {
  return resolve(join(veylinDir(folder), ORIGINALS)) + sep;
}
