#!/usr/bin/env node
/**
 * Bundle @veylin/server for Tauri externalBin sidecar.
 * - esbuild single-file app bundle (workspace TS inlined)
 * - @vercel/nft copies native/transitive runtime deps into sidecar/node_modules
 * - embeds official Node.js binary (no system Node required)
 */
import { build } from 'esbuild';
import { nodeFileTrace } from '@vercel/nft';
import { createWriteStream, cpSync, existsSync, mkdirSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(__dirname, '..');
const repoRoot = resolve(serverRoot, '../..');
const outDir = resolve(serverRoot, 'dist/sidecar');
const binariesDir = resolve(repoRoot, 'apps/desktop/src-tauri/binaries');
const NODE_VERSION = '22.14.0';

const EXTERNALS = [
  '@surrealdb/node',
  'surrealdb',
  '@napi-rs/canvas',
  '@mastra/fastembed',
  'onnxruntime-node',
  '@libsql/client',
  'libsql',
  '@mastra/libsql',
];

const NODE_PLATFORMS = {
  'aarch64-apple-darwin': 'darwin-arm64',
  'x86_64-apple-darwin': 'darwin-x64',
  'aarch64-unknown-linux-gnu': 'linux-arm64',
  'x86_64-unknown-linux-gnu': 'linux-x64',
  'x86_64-pc-windows-msvc': 'win-x64',
};

const targetTriple = execSync('rustc --print host-tuple', { encoding: 'utf8' }).trim();
const nodePlatform = NODE_PLATFORMS[targetTriple];
if (!nodePlatform) {
  throw new Error(`[build-sidecar] unsupported Rust target triple: ${targetTriple}`);
}

const isWindows = nodePlatform.startsWith('win');
const binBase = isWindows ? 'veylin-server.exe' : 'veylin-server';
const binName = `${binBase}-${targetTriple}`;

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
mkdirSync(join(outDir, 'node_modules'), { recursive: true });
mkdirSync(binariesDir, { recursive: true });

const outfile = join(outDir, 'server.mjs');

await build({
  entryPoints: [resolve(serverRoot, 'src/server.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'bundle',
  external: EXTERNALS,
  banner: {
    js: [
      "import { createRequire as __ia_createRequire } from 'node:module';",
      "import { fileURLToPath as __ia_fileURLToPath } from 'node:url';",
      "import { dirname as __ia_dirname } from 'node:path';",
      'const require = __ia_createRequire(import.meta.url);',
      'const __filename = __ia_fileURLToPath(import.meta.url);',
      'const __dirname = __ia_dirname(__filename);',
    ].join('\n'),
  },
  plugins: [
    {
      name: 'external-native',
      setup(b) {
        b.onResolve({ filter: /^@anush008\// }, (args) => ({ path: args.path, external: true }));
        b.onResolve({ filter: /\.node$/ }, (args) => ({ path: args.path, external: true }));
      },
    },
  ],
  sourcemap: false,
  logLevel: 'info',
});

writeFileSync(join(outDir, 'package.json'), JSON.stringify({ type: 'module', name: 'veylin-server-sidecar' }, null, 2));

// Bundle the stdio MCP servers so they run under the embedded Node (no tsx needed).
const mcpServersRoot = resolve(repoRoot, 'packages/mcp-servers/src');
for (const mcpName of ['scheduling-server', 'maintenance-server']) {
  await build({
    entryPoints: [join(mcpServersRoot, `${mcpName}.ts`)],
    outfile: join(outDir, `${mcpName}.mjs`),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    packages: 'bundle',
    banner: {
      js: [
        "import { createRequire as __ia_createRequire } from 'node:module';",
        'const require = __ia_createRequire(import.meta.url);',
      ].join('\n'),
    },
    sourcemap: false,
    logLevel: 'error',
  });
}

// Trace and copy runtime files for external imports.
const { fileList } = await nodeFileTrace([outfile], {
  base: repoRoot,
  processCwd: repoRoot,
});

for (const absPath of fileList) {
  if (!absPath.startsWith(repoRoot)) continue;
  const rel = relative(repoRoot, absPath);
  const dest = join(outDir, rel);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(absPath, dest);
}

// Ensure SurrealDB native shims from nested installs are present.
for (const base of [
  resolve(repoRoot, 'node_modules'),
  resolve(repoRoot, 'packages/db/node_modules'),
]) {
  for (const scope of ['@surrealdb', '@anush008']) {
    const src = join(base, scope);
    if (!existsSync(src)) continue;
    cpSync(src, join(outDir, 'node_modules', scope), { recursive: true });
  }
  for (const pkg of ['surrealdb']) {
    const src = join(base, pkg);
    if (existsSync(src)) cpSync(src, join(outDir, 'node_modules', pkg), { recursive: true });
  }
}

await embedNodeRuntime(nodePlatform, join(outDir, 'node-runtime'));

const launcherPath = join(binariesDir, binName);
writeLauncher(launcherPath, isWindows);
chmodSync(launcherPath, isWindows ? 0o644 : 0o755);

const baseLink = join(binariesDir, binBase);
rmSync(baseLink, { force: true });
cpSync(launcherPath, baseLink);
if (!isWindows) chmodSync(baseLink, 0o755);

console.log(`[build-sidecar] wrote ${launcherPath}`);
console.log(`[build-sidecar] bundle at ${outDir}`);
console.log(`[build-sidecar] node ${NODE_VERSION} (${nodePlatform}) embedded`);

function writeLauncher(path, win) {
  if (win) {
    writeFileSync(
      path,
      `@echo off\r\nset "DIR=%~dp0"\r\nset "SIDE=%DIR%..\\Resources\\sidecar"\r\nif not exist "%SIDE%" set "SIDE=%DIR%sidecar"\r\nset "NODE=%SIDE%\\node-runtime\\node.exe"\r\nif not exist "%NODE%" set "NODE=node"\r\n"%NODE%" "%SIDE%\\server.mjs" %*\r\n`,
    );
    return;
  }
  writeFileSync(
    path,
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'DIR="$(cd "$(dirname "$0")" && pwd)"',
      'if [ -d "$DIR/../Resources/sidecar" ]; then',
      '  SIDE="$DIR/../Resources/sidecar"',
      'elif [ -d "$DIR/sidecar" ]; then',
      '  SIDE="$DIR/sidecar"',
      'else',
      '  SIDE="${VEYLIN_SIDECAR_DIR:-$DIR/../../../server/dist/sidecar}"',
      'fi',
      'NODE_BIN="$SIDE/node-runtime/bin/node"',
      'if [ ! -x "$NODE_BIN" ]; then',
      '  NODE_BIN="$(command -v node 2>/dev/null || true)"',
      'fi',
      'if [ -z "$NODE_BIN" ]; then',
      '  echo "[veylin-server] embedded Node runtime missing and node not on PATH" >&2',
      '  exit 1',
      'fi',
      'cd "$SIDE"',
      'exec "$NODE_BIN" "$SIDE/server.mjs" "$@"',
      '',
    ].join('\n'),
  );
}

async function embedNodeRuntime(platform, destRoot) {
  const cacheRoot = join(serverRoot, '.cache', `node-v${NODE_VERSION}-${platform}`);
  const archiveName = `node-v${NODE_VERSION}-${platform}`;
  const isWin = platform.startsWith('win');
  const nodeRel = isWin ? 'node.exe' : 'bin/node';
  const cachedNode = join(cacheRoot, nodeRel);

  if (!existsSync(cachedNode)) {
    mkdirSync(cacheRoot, { recursive: true });
    const ext = isWin ? 'zip' : 'tar.gz';
    const url = `https://nodejs.org/dist/v${NODE_VERSION}/${archiveName}.${ext}`;
    const archivePath = join(cacheRoot, `${archiveName}.${ext}`);
    console.log(`[build-sidecar] downloading ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download Node.js: ${res.status} ${url}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(archivePath));

    if (isWin) {
      execSync(`unzip -q -o "${archivePath}" -d "${cacheRoot}"`, { stdio: 'inherit' });
      cpSync(join(cacheRoot, archiveName, 'node.exe'), cachedNode);
    } else {
      execSync(`tar -xzf "${archivePath}" -C "${cacheRoot}" --strip-components=1`, { stdio: 'inherit' });
    }
  }

  if (isWin) {
    mkdirSync(destRoot, { recursive: true });
    cpSync(cachedNode, join(destRoot, 'node.exe'));
  } else {
    mkdirSync(join(destRoot, 'bin'), { recursive: true });
    cpSync(cachedNode, join(destRoot, 'bin', 'node'));
    chmodSync(join(destRoot, 'bin', 'node'), 0o755);
  }
}
