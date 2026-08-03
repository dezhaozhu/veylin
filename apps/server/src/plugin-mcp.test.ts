import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadEnabledPluginMcpConfigs,
  listPluginInstalls,
} from './plugin-store.js';
import { veylinPluginsJsonPath, veylinHome } from './veylin-paths.js';

describe('loadEnabledPluginMcpConfigs', () => {
  it('loads namespaced stdio configs from enabled plugin .mcp.json', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'veylin-plugin-mcp-'));
    const prevHome = process.env.VEYLIN_HOME;
    process.env.VEYLIN_HOME = root;

    try {
      const pluginDir = join(root, 'plugins', 'demo-plugin');
      await fs.mkdir(join(pluginDir, '.veylin-plugin'), { recursive: true });
      await fs.writeFile(
        join(pluginDir, '.veylin-plugin', 'plugin.json'),
        JSON.stringify({ name: 'demo-plugin', version: '0.0.1', mcpServers: './.mcp.json' }),
        'utf8',
      );
      await fs.writeFile(
        join(pluginDir, '.mcp.json'),
        JSON.stringify({
          mcpServers: {
            solver: {
              command: 'node',
              args: ['./mcp/server.cjs'],
              cwd: '.',
            },
          },
        }),
        'utf8',
      );
      await fs.mkdir(veylinHome(), { recursive: true });
      await fs.writeFile(
        veylinPluginsJsonPath(),
        JSON.stringify({
          plugins: {
            'demo-plugin': {
              version: '0.0.1',
              description: null,
              sourceType: 'path',
              source: pluginDir,
              installPath: pluginDir,
              enabled: true,
            },
          },
        }),
        'utf8',
      );

      const installs = await listPluginInstalls('tenant-test');
      assert.equal(installs.length, 1);

      const configs = await loadEnabledPluginMcpConfigs('tenant-test');
      assert.ok(configs['demo-plugin/solver']);
      assert.equal(configs['demo-plugin/solver']!.command, 'node');
      assert.deepEqual(configs['demo-plugin/solver']!.args, ['./mcp/server.cjs']);
      assert.equal(configs['demo-plugin/solver']!.cwd, pluginDir);
    } finally {
      if (prevHome === undefined) delete process.env.VEYLIN_HOME;
      else process.env.VEYLIN_HOME = prevHome;
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
