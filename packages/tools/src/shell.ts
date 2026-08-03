import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export const bash = createTool({
  id: 'bash',
  description:
    'Run a shell command in the workspace for genuine system/terminal operations ' +
    '(git, package managers, build/test runners, etc.). Destructive: requires approval. ' +
    'Do NOT use bash for file operations that have dedicated tools: use file_read instead of ' +
    'cat/head/tail, file_edit/file_write instead of sed/awk/echo redirection, list_dir/glob ' +
    'instead of ls/find, and grep (the tool) instead of grep/rg. ' +
    'ALWAYS quote paths that contain spaces. Avoid interactive commands (they will hang).',
  requireApproval: true,
  inputSchema: z.object({
    command: z.string().describe('The shell command to run'),
    cwd: z.string().optional().describe('Working directory; defaults to the workspace root'),
    timeoutMs: z.number().int().default(60_000).describe('Kill the command after this many ms'),
  }),
  outputSchema: z.object({
    stdout: z.string(),
    stderr: z.string(),
    exitCode: z.number(),
  }),
  execute: async (input) => {
    try {
      const { stdout, stderr } = await execAsync(input.command, {
        cwd: input.cwd,
        timeout: input.timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
      });
      return { stdout, stderr, exitCode: 0 };
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; code?: number; message?: string };
      return {
        stdout: e.stdout ?? '',
        stderr: e.stderr ?? e.message ?? 'command failed',
        exitCode: typeof e.code === 'number' ? e.code : 1,
      };
    }
  },
});
