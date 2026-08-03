import { promises as fs } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';

const READY_MARKER = '.veylin-runtime-ready';

type RunResult = { code: number | null; stdout: string; stderr: string };

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
): Promise<RunResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (c: Buffer) => {
      stdout += c.toString();
    });
    child.stderr?.on('data', (c: Buffer) => {
      stderr += c.toString();
    });
    child.on('error', (e) => reject(e));
    child.on('close', (code) => {
      resolvePromise({ code, stdout, stderr });
    });
  });
}

async function runOrThrow(
  command: string,
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
): Promise<void> {
  let result: RunResult;
  try {
    result = await runCommand(command, args, cwd, env);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`${command} ${args.join(' ')}: ${msg}`);
  }
  if (result.code === 0) return;
  const detail = (result.stderr || result.stdout).trim();
  // Pip often prints a long traceback; keep the actionable tail for UI alerts.
  const clipped =
    detail.length > 1200 ? detail.slice(detail.length - 1200) : detail;
  throw new Error(clipped || `${command} ${args.join(' ')} failed (${result.code})`);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function findRequirements(installPath: string): Promise<string | null> {
  for (const rel of ['requirements.txt', 'scripts/requirements.txt']) {
    const p = join(installPath, rel);
    if (await pathExists(p)) return p;
  }
  return null;
}

/** Resolve a system Python usable for venv (GUI apps often lack Homebrew on PATH). */
export async function resolveSystemPython(): Promise<string> {
  const candidates = [
    process.env.VEYLIN_PYTHON?.trim(),
    'python3',
    'python',
    '/opt/homebrew/bin/python3',
    '/usr/local/bin/python3',
    '/usr/bin/python3',
    join(homedir(), '.local/bin/python3'),
  ].filter(Boolean) as string[];

  for (const cmd of candidates) {
    try {
      const result = await runCommand(cmd, ['-c', 'import sys; print(sys.executable)'], process.cwd());
      if (result.code === 0) {
        const exe = result.stdout.trim().split('\n').pop()?.trim();
        if (exe) return exe;
      }
    } catch {
      // try next
    }
  }
  throw new Error(
    'python3 not found (install Python 3, or set VEYLIN_PYTHON to the interpreter path)',
  );
}

async function resolveVenvPython(venvDir: string): Promise<string> {
  const names =
    process.platform === 'win32'
      ? ['python.exe', 'python3.exe']
      : ['python', 'python3'];
  const dir = process.platform === 'win32' ? join(venvDir, 'Scripts') : join(venvDir, 'bin');
  for (const name of names) {
    const p = join(dir, name);
    if (await pathExists(p)) return p;
  }
  throw new Error(`venv python missing under ${dir}`);
}

async function ensurePythonVenv(installPath: string, requirementsPath: string): Promise<void> {
  const venvDir = join(installPath, '.venv');
  const pipTmp = join(installPath, '.pip-tmp');
  await fs.mkdir(pipTmp, { recursive: true });

  let py: string;
  if (await pathExists(venvDir)) {
    try {
      py = await resolveVenvPython(venvDir);
    } catch {
      await fs.rm(venvDir, { recursive: true, force: true });
      const systemPy = await resolveSystemPython();
      await runOrThrow(systemPy, ['-m', 'venv', venvDir], installPath);
      py = await resolveVenvPython(venvDir);
    }
  } else {
    const systemPy = await resolveSystemPython();
    await runOrThrow(systemPy, ['-m', 'venv', venvDir], installPath);
    py = await resolveVenvPython(venvDir);
  }

  // Prefer path relative to cwd so pip does not depend on absolute path quirks.
  const reqArg = isAbsolute(requirementsPath)
    ? relative(installPath, requirementsPath) || requirementsPath
    : requirementsPath;

  const env: NodeJS.ProcessEnv = {
    TMPDIR: pipTmp,
    TEMP: pipTmp,
    TMP: pipTmp,
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
  };

  // Do NOT `pip install --upgrade pip` — self-upgrade often hits Errno 2 on macOS.
  const pipArgs = ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', reqArg];
  try {
    await runOrThrow(py, pipArgs, installPath, env);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // One retry with a fresh venv when pip leaves a broken tree.
    if (/No such file or directory|Errno 2/i.test(msg)) {
      await fs.rm(venvDir, { recursive: true, force: true });
      await fs.mkdir(pipTmp, { recursive: true });
      const systemPy = await resolveSystemPython();
      await runOrThrow(systemPy, ['-m', 'venv', venvDir], installPath);
      py = await resolveVenvPython(venvDir);
      await runOrThrow(py, pipArgs, installPath, env);
    } else {
      throw err;
    }
  }
}

async function ensureMcpNpm(installPath: string): Promise<void> {
  const mcpPkg = join(installPath, 'mcp', 'package.json');
  if (!(await pathExists(mcpPkg))) return;
  const mcpDir = join(installPath, 'mcp');
  const lock = join(mcpDir, 'package-lock.json');
  if (await pathExists(lock)) {
    await runOrThrow('npm', ['ci', '--omit=dev'], mcpDir);
  } else {
    await runOrThrow('npm', ['install', '--omit=dev'], mcpDir);
  }
}

/**
 * Install-time bootstrap for plugin runtimes (venv + ortools, mcp npm, …).
 * Idempotent via `.veylin-runtime-ready` marker.
 */
export async function ensurePluginRuntime(installPath: string): Promise<void> {
  const marker = join(installPath, READY_MARKER);
  if (await pathExists(marker)) return;

  const requirements = await findRequirements(installPath);
  if (requirements) {
    await ensurePythonVenv(installPath, requirements);
  }
  await ensureMcpNpm(installPath);

  if (requirements || (await pathExists(join(installPath, 'mcp', 'package.json')))) {
    await fs.writeFile(
      marker,
      `${JSON.stringify({ readyAt: new Date().toISOString() }, null, 2)}\n`,
      'utf8',
    );
  }
}

export function pluginPythonBin(installPath: string): string {
  if (process.platform === 'win32') {
    return join(installPath, '.venv', 'Scripts', 'python.exe');
  }
  return join(installPath, '.venv', 'bin', 'python');
}
