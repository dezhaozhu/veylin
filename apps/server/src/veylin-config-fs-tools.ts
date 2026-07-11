import { promises as fs } from 'node:fs';
import { dirname, join, normalize, relative, resolve, sep } from 'node:path';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  veylinHome,
  veylinHooksPath,
  veylinMcpLocalPath,
  veylinMcpPath,
  veylinPluginsDir,
  veylinPluginsJsonPath,
  veylinRulesDir,
  veylinSettingsLocalPath,
  veylinSettingsPath,
  veylinSkillsRoot,
} from './veylin-paths.js';
import { getWorkspaceRootSetting } from './veylin-settings-file.js';
import { reloadHooksForTenant } from './hooks-service.js';

export interface BuildConfigFsToolsOptions {
  onMcpRebuild: (tenantId: string) => Promise<void>;
}

interface ConfigCtx {
  requestContext?: { get(key: string): unknown };
}

function ctxValue(ctx: ConfigCtx | undefined, key: string): string | undefined {
  return ctx?.requestContext?.get(key) as string | undefined;
}

function isInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !rel.startsWith('..'));
}

type AllowEntry = { kind: 'dir' | 'file'; path: string; write: boolean };

async function allowlist(tenantId: string): Promise<AllowEntry[]> {
  const entries: AllowEntry[] = [
    { kind: 'dir', path: veylinSkillsRoot(), write: true },
    { kind: 'dir', path: veylinRulesDir(), write: true },
    { kind: 'file', path: veylinSettingsPath(), write: true },
    { kind: 'file', path: veylinSettingsLocalPath(), write: true },
    { kind: 'file', path: veylinHooksPath(), write: true },
    { kind: 'file', path: veylinMcpPath(), write: true },
    { kind: 'file', path: veylinMcpLocalPath(), write: true },
    { kind: 'file', path: veylinPluginsJsonPath(), write: true },
    { kind: 'dir', path: veylinPluginsDir(), write: false },
  ];
  const workspace = await getWorkspaceRootSetting(tenantId);
  if (workspace) {
    entries.push(
      { kind: 'file', path: join(workspace, '.veylin', 'hooks.json'), write: true },
      { kind: 'file', path: join(workspace, '.veylin', 'hooks.local.json'), write: true },
    );
  }
  return entries;
}

/** Resolve user path to absolute under ~/.veylin allowlist. */
function toAbsolute(inputPath: string): string {
  const home = veylinHome();
  const p = inputPath.trim();
  if (p === '~/.veylin' || p.startsWith('~/.veylin/') || p === '.veylin' || p.startsWith('.veylin/')) {
    return normalize(join(home, p.replace(/^~\/?/, '').replace(/^\.veylin\/?/, '')));
  }
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) {
    return normalize(resolve(p));
  }
  // relative to ~/.veylin
  return normalize(join(home, p));
}

async function resolveAllowedPath(
  tenantId: string,
  inputPath: string,
  forWrite: boolean,
): Promise<string> {
  const abs = toAbsolute(inputPath);
  const entries = await allowlist(tenantId);

  for (const entry of entries) {
    const root = resolve(entry.path);
    if (entry.kind === 'file') {
      if (abs === root) {
        if (forWrite && !entry.write) throw new Error(`Write not allowed: ${inputPath}`);
        return abs;
      }
      continue;
    }
    if (isInside(root, abs)) {
      if (forWrite && !entry.write) throw new Error(`Write not allowed under ${entry.path}`);
      return abs;
    }
  }

  throw new Error(
    `Path not in allowlist (skills, rules, settings, hooks, mcp, plugins.json under ~/.veylin): ${inputPath}`,
  );
}

async function afterWrite(
  tenantId: string,
  abs: string,
  onMcpRebuild: (t: string) => Promise<void>,
) {
  if (
    abs === resolve(veylinHooksPath()) ||
    abs.endsWith(`${sep}hooks.json`) ||
    abs.endsWith(`${sep}hooks.local.json`)
  ) {
    await reloadHooksForTenant(tenantId);
  }
  if (abs === resolve(veylinMcpPath()) || abs === resolve(veylinMcpLocalPath())) {
    await onMcpRebuild(tenantId);
  }
}

export function buildConfigFsTools(opts: BuildConfigFsToolsOptions) {
  const { onMcpRebuild } = opts;

  const configRead = createTool({
    id: 'config_read',
    description:
      'Read a Veylin config file or list a config directory under ~/.veylin (skills, rules, settings, hooks, mcp, plugins). Use paths relative to ~/.veylin (e.g. skills/foo/SKILL.md) or ~/.veylin/...',
    inputSchema: z.object({
      path: z.string().describe('Path relative to ~/.veylin, or ~/.veylin/...'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      path: z.string().optional(),
      kind: z.enum(['file', 'directory']).optional(),
      content: z.string().optional(),
      entries: z.array(z.string()).optional(),
      error: z.string().optional(),
    }),
    execute: async (input: { path: string }, ctx?: ConfigCtx) => {
      const tenantId = ctxValue(ctx, 'tenantId') ?? '00000000-0000-0000-0000-000000000000';
      try {
        const abs = await resolveAllowedPath(tenantId, input.path, false);
        const st = await fs.stat(abs);
        if (st.isDirectory()) {
          const entries = await fs.readdir(abs);
          return { ok: true, path: abs, kind: 'directory' as const, entries };
        }
        const content = await fs.readFile(abs, 'utf8');
        return { ok: true, path: abs, kind: 'file' as const, content };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  });

  const configWrite = createTool({
    id: 'config_write',
    description:
      'Create or overwrite a Veylin config file (skills, rules, settings, hooks, mcp.json, plugins.json). Set delete=true to remove a file or directory. Plugin package dirs are read-only — install plugins in Settings.',
    inputSchema: z.object({
      path: z.string(),
      content: z.string().optional().describe('File contents (required unless delete=true)'),
      delete: z.boolean().optional(),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      path: z.string().optional(),
      deleted: z.boolean().optional(),
      error: z.string().optional(),
    }),
    execute: async (
      input: { path: string; content?: string; delete?: boolean },
      ctx?: ConfigCtx,
    ) => {
      const tenantId = ctxValue(ctx, 'tenantId') ?? '00000000-0000-0000-0000-000000000000';
      try {
        const abs = await resolveAllowedPath(tenantId, input.path, true);
        if (input.delete) {
          await fs.rm(abs, { recursive: true, force: true });
          await afterWrite(tenantId, abs, onMcpRebuild);
          return { ok: true, path: abs, deleted: true };
        }
        if (input.content == null) throw new Error('content is required unless delete=true');
        await fs.mkdir(dirname(abs), { recursive: true });
        await fs.writeFile(abs, input.content, 'utf8');
        await afterWrite(tenantId, abs, onMcpRebuild);
        return { ok: true, path: abs };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  });

  return { config_read: configRead, config_write: configWrite };
}
