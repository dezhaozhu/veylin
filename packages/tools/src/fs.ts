import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { promises as fs } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { defaultDocumentProvider } from './document-provider';
import { isUnchangedSinceRead, recordRead, staleWriteError, unchangedStub } from './read-state';

function threadIdOf(ctx?: { requestContext?: { get(key: string): unknown } }): string | undefined {
  return ctx?.requestContext?.get('threadId') as string | undefined;
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.mastra']);

export const fileRead = createTool({
  id: 'file_read',
  description:
    'Read a file from disk. ALWAYS read a file before editing or overwriting it. ' +
    'Text is returned with line numbers in the format "   1|<line>"; the number prefix is ' +
    'metadata, not part of the file content. Use offset/limit to page through large files ' +
    'instead of reading everything. PDF returns extracted text when a text layer exists; ' +
    'images return only metadata — attach the file in the composer for a vision model to see it. ' +
    'Prefer this over running cat/head/tail through the bash tool.',
  inputSchema: z.object({
    path: z.string().describe('Absolute or workspace-relative file path'),
    offset: z.number().int().min(1).optional().describe('1-based start line'),
    limit: z.number().int().min(1).optional().describe('Max number of lines'),
  }),
  outputSchema: z.object({
    kind: z.enum(['text', 'image', 'pdf', 'binary']),
    content: z.string(),
    totalLines: z.number(),
    mediaType: z.string().optional(),
    bytes: z.number().optional(),
    lineFormat: z.string().optional(),
  }),
  execute: async (input, ctx) => {
    const provider = defaultDocumentProvider;
    const threadId = threadIdOf(ctx);
    let stat;
    try {
      stat = await provider.stat(input.path);
    } catch {
      return {
        kind: 'binary' as const,
        content: `File not found: ${input.path}`,
        totalLines: 0,
      };
    }

    // Dedup: a full re-read of an unchanged file returns a compact stub.
    const isFullRead = input.offset == null && input.limit == null;
    if (
      stat.kind === 'text' &&
      isFullRead &&
      isUnchangedSinceRead(threadId, input.path, { mtimeMs: stat.mtimeMs, size: stat.bytes })
    ) {
      return {
        kind: 'text' as const,
        content: unchangedStub(input.path),
        totalLines: 0,
      };
    }

    if (stat.kind === 'image') {
      return {
        kind: 'image' as const,
        mediaType: stat.mediaType,
        bytes: stat.bytes,
        totalLines: 0,
        content:
          `IMAGE file (${stat.mediaType}, ${stat.bytes} bytes). ` +
          `Attach the file in the composer for the model to view it.`,
      };
    }

    if (stat.kind === 'pdf') {
      const text = (await provider.readPdfText?.(input.path)) ?? null;
      return {
        kind: 'pdf' as const,
        mediaType: stat.mediaType ?? 'application/pdf',
        bytes: stat.bytes,
        totalLines: text ? text.split('\n').length : 0,
        content:
          text ??
          `PDF file (${stat.bytes} bytes) has no extractable text layer. ` +
            `Attach it in the composer for vision models.`,
      };
    }

    const { content, totalLines, lineFormat } = await provider.readText(input.path, {
      offset: input.offset,
      limit: input.limit,
    });
    recordRead(threadId, input.path, { mtimeMs: stat.mtimeMs, size: stat.bytes });
    return {
      kind: 'text' as const,
      content,
      totalLines,
      lineFormat,
    };
  },
});

export const fileWrite = createTool({
  id: 'file_write',
  description:
    'Create a new text file or overwrite an existing one in full. Destructive: requires ' +
    'approval. NEVER use this to make a small change to an existing file — use file_edit ' +
    'instead. If the file already exists you MUST read it first; overwriting blindly can ' +
    'lose data. Prefer editing an existing file over creating a new one.',
  requireApproval: true,
  inputSchema: z.object({ path: z.string(), content: z.string() }),
  outputSchema: z.object({ path: z.string(), bytes: z.number() }),
  execute: async (input, ctx) => {
    const target = resolve(input.path);
    const threadId = threadIdOf(ctx);
    const existing = await fs.stat(target).catch(() => null);
    if (existing) {
      const stale = staleWriteError(threadId, target, {
        mtimeMs: existing.mtimeMs,
        size: existing.size,
      });
      if (stale) throw new Error(stale);
    }
    await fs.writeFile(target, input.content, 'utf8');
    const after = await fs.stat(target).catch(() => null);
    if (after) recordRead(threadId, target, { mtimeMs: after.mtimeMs, size: after.size });
    return { path: target, bytes: Buffer.byteLength(input.content) };
  },
});

export const fileEdit = createTool({
  id: 'file_edit',
  description:
    'Replace an exact string in an existing file. Destructive: requires approval. ' +
    'ALWAYS read the file first. The oldString MUST uniquely identify the target: include ' +
    'enough surrounding context (whitespace and indentation exactly as in the file) so it ' +
    'matches exactly one location, unless replaceAll is set. The edit fails if oldString is ' +
    'not found. Keep edits minimal and scoped to the requested change.',
  requireApproval: true,
  inputSchema: z.object({
    path: z.string(),
    oldString: z.string().describe('Exact text to replace, including surrounding context to make it unique'),
    newString: z.string().describe('Replacement text (must differ from oldString)'),
    replaceAll: z.boolean().default(false).describe('Replace every occurrence instead of requiring uniqueness'),
  }),
  outputSchema: z.object({ path: z.string(), replacements: z.number() }),
  execute: async (input, ctx) => {
    const target = resolve(input.path);
    const threadId = threadIdOf(ctx);
    const before = await fs.stat(target).catch(() => null);
    if (before) {
      const stale = staleWriteError(threadId, target, {
        mtimeMs: before.mtimeMs,
        size: before.size,
      });
      if (stale) throw new Error(stale);
    }
    const raw = await fs.readFile(target, 'utf8');
    if (!raw.includes(input.oldString)) throw new Error('oldString not found in file');
    const replacements = input.replaceAll ? raw.split(input.oldString).length - 1 : 1;
    const next = input.replaceAll
      ? raw.split(input.oldString).join(input.newString)
      : raw.replace(input.oldString, input.newString);
    await fs.writeFile(target, next, 'utf8');
    const after = await fs.stat(target).catch(() => null);
    if (after) recordRead(threadId, target, { mtimeMs: after.mtimeMs, size: after.size });
    return { path: target, replacements };
  },
});

export const listDir = createTool({
  id: 'list_dir',
  description:
    'List the entries of a single directory (non-recursive). Use this to explore an unknown ' +
    'directory layout. To find files across a tree use glob; to search file contents use grep. ' +
    'Prefer this over running ls through the bash tool.',
  inputSchema: z.object({ path: z.string().default('.') }),
  outputSchema: z.object({ entries: z.array(z.object({ name: z.string(), type: z.string() })) }),
  execute: async (input) => {
    const dir = resolve(input.path ?? '.');
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    return {
      entries: dirents.map((d) => ({ name: d.name, type: d.isDirectory() ? 'dir' : 'file' })),
    };
  },
});

async function walk(dir: string, out: string[], depth: number): Promise<void> {
  if (depth < 0) return;
  let dirents;
  try {
    dirents = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const d of dirents) {
    if (d.isDirectory()) {
      if (SKIP_DIRS.has(d.name)) continue;
      await walk(join(dir, d.name), out, depth - 1);
    } else {
      out.push(join(dir, d.name));
    }
  }
}

function globToRegExp(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        re += '.*';
        i++;
        if (pattern[i + 1] === '/') i++;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$');
}

export const glob = createTool({
  id: 'glob',
  description:
    'Find files by name/path glob pattern (supports **, *, ?) within a directory tree. ' +
    'Use this to locate files by name when you do not know their exact path. ' +
    'ALWAYS prefer this over running find/ls through the bash tool. ' +
    'To search file contents instead of names, use grep.',
  inputSchema: z.object({
    pattern: z.string().describe('Glob like "src/**/*.ts" relative to path'),
    path: z.string().default('.'),
    maxResults: z.number().int().default(200),
    maxDepth: z.number().int().default(12),
  }),
  outputSchema: z.object({ files: z.array(z.string()) }),
  execute: async (input) => {
    const root = resolve(input.path ?? '.');
    const all: string[] = [];
    await walk(root, all, input.maxDepth ?? 12);
    const re = globToRegExp(input.pattern);
    const files = all
      .map((f) => relative(root, f))
      .filter((rel) => re.test(rel))
      .slice(0, input.maxResults ?? 200);
    return { files };
  },
});

export const grep = createTool({
  id: 'grep',
  description:
    'Search file contents for a regular expression within a directory tree, returning matching ' +
    'file/line/text. Use this to find where a symbol, string, or pattern is used. ' +
    'ALWAYS prefer this over running grep/rg through the bash tool. ' +
    'To find files by name instead of contents, use glob.',
  inputSchema: z.object({
    pattern: z.string(),
    path: z.string().default('.'),
    maxResults: z.number().int().default(100),
    maxDepth: z.number().int().default(8),
  }),
  outputSchema: z.object({
    matches: z.array(z.object({ file: z.string(), line: z.number(), text: z.string() })),
  }),
  execute: async (input) => {
    const maxResults = input.maxResults ?? 100;
    const maxDepth = input.maxDepth ?? 8;
    const root = resolve(input.path ?? '.');
    const files: string[] = [];
    await walk(root, files, maxDepth);
    const re = new RegExp(input.pattern);
    const matches: { file: string; line: number; text: string }[] = [];
    for (const file of files) {
      if (matches.length >= maxResults) break;
      let content: string;
      try {
        content = await fs.readFile(file, 'utf8');
      } catch {
        continue;
      }
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const text = lines[i] ?? '';
        if (re.test(text)) {
          matches.push({ file: relative(root, file), line: i + 1, text: text.slice(0, 400) });
          if (matches.length >= maxResults) break;
        }
      }
    }
    return { matches };
  },
});