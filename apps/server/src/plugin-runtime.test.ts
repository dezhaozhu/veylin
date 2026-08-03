import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensurePluginRuntime, pluginPythonBin } from './plugin-runtime.js';

describe('ensurePluginRuntime', () => {
  it('bootstraps a venv from requirements.txt and writes ready marker', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'veylin-runtime-'));
    await fs.writeFile(join(root, 'requirements.txt'), '# no packages\n', 'utf8');
    await ensurePluginRuntime(root);
    await fs.access(join(root, '.veylin-runtime-ready'));
    await fs.access(pluginPythonBin(root));
    // second call is idempotent
    await ensurePluginRuntime(root);
    await fs.rm(root, { recursive: true, force: true });
  });
});
