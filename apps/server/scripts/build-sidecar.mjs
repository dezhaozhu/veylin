#!/usr/bin/env node
/**
 * Bundle @veylin/server for Tauri externalBin sidecar.
 * - esbuild single-file app bundle (workspace TS inlined)
 * - @vercel/nft copies native/transitive runtime deps into sidecar/node_modules
 * - embeds official Node.js binary (no system Node required)
 */
import { build } from 'esbuild';
import { nodeFileTrace } from '@vercel/nft';
import {
  chmodSync,
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
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
  '@huggingface/transformers',
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

const targetTriple = resolveTargetTriple();
const nodePlatform = NODE_PLATFORMS[targetTriple];
if (!nodePlatform) {
  throw new Error(`[build-sidecar] unsupported Rust target triple: ${targetTriple}`);
}

const isWindows = nodePlatform.startsWith('win');
const binBase = 'veylin-server';
const binName = `${binBase}-${targetTriple}${isWindows ? '.exe' : ''}`;

function resolveTargetTriple() {
  for (const key of ['CARGO_BUILD_TARGET', 'TAURI_ENV_TARGET_TRIPLE']) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return execSync('rustc --print host-tuple', { encoding: 'utf8' }).trim();
}

/** Keep only native binaries for the target triple; drop dev artifacts. */
const NATIVE_PRUNE = {
  'aarch64-apple-darwin': {
    surrealdbNpm: 'darwin-arm64',
    surrealdbPkgs: ['node', 'node-darwin-arm64'],
    onnxKeep: ['darwin', 'arm64'],
    scopedKeeps: {
      '@napi-rs': ['canvas', 'wasm-runtime', 'canvas-darwin-arm64'],
      '@anush008': ['tokenizers', 'tokenizers-darwin-universal'],
      '@libsql': ['client', 'core', 'hrana-client', 'isomorphic-ws', 'darwin-arm64'],
    },
  },
  'x86_64-apple-darwin': {
    surrealdbNpm: 'darwin-x64',
    surrealdbPkgs: ['node', 'node-darwin-x64'],
    onnxKeep: ['darwin', 'x64'],
    scopedKeeps: {
      '@napi-rs': ['canvas', 'wasm-runtime', 'canvas-darwin-x64'],
      '@anush008': ['tokenizers', 'tokenizers-darwin-universal'],
      '@libsql': ['client', 'core', 'hrana-client', 'isomorphic-ws', 'darwin-x64'],
    },
  },
  'aarch64-unknown-linux-gnu': {
    surrealdbNpm: 'linux-arm64-gnu',
    surrealdbPkgs: ['node', 'node-linux-arm64-gnu'],
    onnxKeep: ['linux', 'arm64'],
    scopedKeeps: {
      '@napi-rs': ['canvas', 'wasm-runtime', 'canvas-linux-arm64-gnu'],
      '@anush008': ['tokenizers', 'tokenizers-linux-arm64-gnu'],
      '@libsql': ['client', 'core', 'hrana-client', 'isomorphic-ws', 'linux-arm64-gnu'],
    },
  },
  'x86_64-unknown-linux-gnu': {
    surrealdbNpm: 'linux-x64-gnu',
    surrealdbPkgs: ['node', 'node-linux-x64-gnu'],
    onnxKeep: ['linux', 'x64'],
    scopedKeeps: {
      '@napi-rs': ['canvas', 'wasm-runtime', 'canvas-linux-x64-gnu'],
      '@anush008': ['tokenizers', 'tokenizers-linux-x64-gnu'],
      '@libsql': ['client', 'core', 'hrana-client', 'isomorphic-ws', 'linux-x64-gnu'],
    },
  },
  'x86_64-pc-windows-msvc': {
    surrealdbNpm: 'win32-x64-msvc',
    surrealdbPkgs: ['node', 'node-win32-x64-msvc'],
    onnxKeep: ['win32', 'x64'],
    scopedKeeps: {
      '@napi-rs': ['canvas', 'wasm-runtime', 'canvas-win32-x64-msvc'],
      '@anush008': ['tokenizers', 'tokenizers-win32-x64-msvc'],
      '@libsql': ['client', 'core', 'hrana-client', 'isomorphic-ws', 'win32-x64-msvc'],
    },
  },
};

function dirSizeMb(root) {
  try {
    const out = execSync(`du -sk ${JSON.stringify(root)}`, { encoding: 'utf8' });
    return Number.parseInt(out.split(/\s+/)[0], 10) / 1024;
  } catch {
    return 0;
  }
}

function walkFiles(root, onFile) {
  if (!existsSync(root)) return;
  for (const ent of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, ent.name);
    if (ent.isDirectory()) walkFiles(path, onFile);
    else if (ent.isFile()) onFile(path);
  }
}

function pruneDirEntries(dir, keep) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (!keep.has(entry)) {
      rmSync(join(dir, entry), { recursive: true, force: true });
    }
  }
}

/** Remove any leftover musl native addons on glibc Linux targets. */
function pruneMuslSafetyNet(nodeModules, triple) {
  if (!triple.includes('gnu')) return;
  for (const scope of readdirSync(nodeModules)) {
    if (!scope.startsWith('@')) continue;
    const scopeDir = join(nodeModules, scope);
    for (const pkg of readdirSync(scopeDir)) {
      if (pkg.includes('-musl')) {
        rmSync(join(scopeDir, pkg), { recursive: true, force: true });
        console.log(`[build-sidecar] removed musl package ${scope}/${pkg}`);
      }
    }
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function downloadFileWithRetry(url, dest, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
      return;
    } catch (error) {
      lastError = error;
      rmSync(dest, { force: true });
      if (attempt < attempts) {
        console.warn(`[build-sidecar] download failed (${attempt}/${attempts}), retrying: ${url}`);
        await delay(1000 * attempt);
      }
    }
  }
  throw new Error(`Failed to download ${url}: ${lastError?.message ?? lastError}`);
}

function pruneOnnxGpuProviders(onnxBinDir) {
  if (!existsSync(onnxBinDir)) return 0;

  const gpuProviderNames = [
    'libonnxruntime_providers_cuda',
    'libonnxruntime_providers_tensorrt',
    'libonnxruntime_providers_openvino',
    'libonnxruntime_providers_rocm',
    'onnxruntime_providers_cuda',
    'onnxruntime_providers_tensorrt',
    'onnxruntime_providers_openvino',
    'onnxruntime_providers_rocm',
  ];
  let removed = 0;

  walkFiles(onnxBinDir, (file) => {
    const name = file.split(/[\\/]/).pop() ?? '';
    if (gpuProviderNames.some((provider) => name.includes(provider))) {
      rmSync(file, { force: true });
      removed += 1;
    }
  });

  return removed;
}

function stripSidecarArtifacts(sidecarRoot) {
  const dropDirs = new Set(['test', 'tests', '__tests__', 'benchmark', 'benchmarks', 'example', 'examples']);
  const nodeModules = join(sidecarRoot, 'node_modules');
  if (!existsSync(nodeModules)) return;

  walkFiles(nodeModules, (file) => {
    const base = file.slice(nodeModules.length + 1);
    const parts = base.split('/');
    if (parts.some((part) => dropDirs.has(part))) {
      rmSync(file, { force: true });
      return;
    }
    if (file.endsWith('.map') || file.endsWith('.d.ts') || file.endsWith('.d.cts') || file.endsWith('.d.mts')) {
      rmSync(file, { force: true });
    }
  });

  const cleanupEmpty = (dir) => {
    if (!existsSync(dir)) return;
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, ent.name);
      if (ent.isDirectory()) cleanupEmpty(path);
    }
    if (dir !== nodeModules && readdirSync(dir).length === 0) {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  cleanupEmpty(nodeModules);
}

function pruneSidecarForTarget(sidecarRoot, triple) {
  const cfg = NATIVE_PRUNE[triple];
  if (!cfg) {
    console.warn(`[build-sidecar] no native prune profile for ${triple}, skipping platform prune`);
    stripSidecarArtifacts(sidecarRoot);
    return;
  }

  const nodeModules = join(sidecarRoot, 'node_modules');

  pruneDirEntries(join(nodeModules, '@surrealdb', 'node', 'npm'), new Set([cfg.surrealdbNpm]));
  pruneDirEntries(join(nodeModules, '@surrealdb'), new Set(cfg.surrealdbPkgs));

  // Keep only target-matching native addon variants. On Linux, npm installs both
  // gnu and musl builds; musl .node files break linuxdeploy's ldd during AppImage bundling.
  for (const [scope, keepList] of Object.entries(cfg.scopedKeeps)) {
    pruneDirEntries(join(nodeModules, scope), new Set(keepList));
  }
  pruneMuslSafetyNet(nodeModules, triple);

  const onnxRoot = join(nodeModules, 'onnxruntime-node', 'bin', 'napi-v6');
  if (existsSync(onnxRoot)) {
    const [keepOs, keepArch] = cfg.onnxKeep;
    for (const os of readdirSync(onnxRoot)) {
      const osPath = join(onnxRoot, os);
      if (os !== keepOs) {
        rmSync(osPath, { recursive: true, force: true });
        continue;
      }
      for (const arch of readdirSync(osPath)) {
        if (arch !== keepArch) {
          rmSync(join(osPath, arch), { recursive: true, force: true });
        }
      }
    }
    const removedGpuProviders = pruneOnnxGpuProviders(join(onnxRoot, keepOs, keepArch));
    if (removedGpuProviders > 0) {
      console.log(`[build-sidecar] removed ${removedGpuProviders} ONNX Runtime GPU provider binaries`);
    }
  }

  for (const pkg of ['typescript', '@types']) {
    rmSync(join(nodeModules, pkg), { recursive: true, force: true });
  }

  stripSidecarArtifacts(sidecarRoot);
}

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

const examplesSrc = join(repoRoot, 'examples', 'veylin');
const examplesDest = join(outDir, 'examples', 'veylin');
if (existsSync(examplesSrc)) {
  mkdirSync(join(outDir, 'examples'), { recursive: true });
  cpSync(examplesSrc, examplesDest, { recursive: true });
  console.log('[build-sidecar] copied examples/veylin default agent pack');
}

// Bundled stdio MCP servers removed; remote MCP is configured per tenant.
// Trace and copy runtime files for the bundled server AND every EXTERNAL package.
// EXTERNALS are not inlined by esbuild and several (e.g. @mastra/libsql) are loaded
// via dynamic require, which static analysis from server.mjs alone cannot follow.
// Resolving each external as an explicit trace entry pulls in their flat deps too.
const sidecarRequire = createRequire(join(repoRoot, 'noop.js'));
const traceEntries = [outfile];
for (const pkg of EXTERNALS) {
  try {
    traceEntries.push(sidecarRequire.resolve(pkg));
  } catch {
    // ESM-only or export-restricted package; covered by whole-dir copy below.
  }
}

const { fileList } = await nodeFileTrace(traceEntries, {
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

// Whole-package copies for native / dynamically-loaded deps that tracing may miss.
// Covers their full package contents (native .node binaries, package.json exports).
const WHOLE_PACKAGE_COPIES = [
  ...EXTERNALS,
  '@mastra/core',
  '@mastra/mcp',
  '@mastra/memory',
  '@mastra/ai-sdk',
  '@mastra/loggers',
  '@mastra/observability',
  '@surrealdb',
  '@anush008',
  '@libsql',
];
const moduleBases = [
  resolve(repoRoot, 'node_modules'),
  resolve(repoRoot, 'apps/server/node_modules'),
  resolve(repoRoot, 'packages/db/node_modules'),
];
const copiedPackages = new Set();

function copyPackageDir(src, dest) {
  cpSync(src, dest, {
    recursive: true,
    filter: (path) => !path.includes('/node_modules/.bin/'),
  });
}

function findPackageDir(pkg) {
  for (const base of moduleBases) {
    const src = join(base, pkg);
    if (existsSync(join(src, 'package.json'))) return src;
  }
  return null;
}

function findScopeDir(scope) {
  for (const base of moduleBases) {
    const src = join(base, scope);
    if (existsSync(src)) return src;
  }
  return null;
}

function copyPackageAndRuntimeDeps(pkg) {
  if (copiedPackages.has(pkg)) return;
  copiedPackages.add(pkg);

  // Allow copying an entire scope, e.g. "@mastra".
  if (pkg.startsWith('@') && pkg.split('/').length === 1) {
    const scopeDir = findScopeDir(pkg);
    if (!scopeDir) return;
    copyPackageDir(scopeDir, join(outDir, 'node_modules', pkg));
    for (const child of readdirSync(scopeDir)) {
      copyPackageAndRuntimeDeps(`${pkg}/${child}`);
    }
    return;
  }

  const src = findPackageDir(pkg);
  if (!src) return;
  copyPackageDir(src, join(outDir, 'node_modules', pkg));

  const packageJsonPath = join(src, 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const deps = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.optionalDependencies ?? {}),
    ...(packageJson.peerDependencies ?? {}),
  };
  for (const dep of Object.keys(deps)) {
    copyPackageAndRuntimeDeps(dep);
  }
}

for (const pkg of WHOLE_PACKAGE_COPIES) {
  copyPackageAndRuntimeDeps(pkg);
}

const beforePruneMb = dirSizeMb(outDir);
pruneSidecarForTarget(outDir, targetTriple);
const afterPruneMb = dirSizeMb(outDir);
console.log(
  `[build-sidecar] pruned sidecar for ${targetTriple}: ${beforePruneMb.toFixed(1)}MB -> ${afterPruneMb.toFixed(1)}MB`,
);

await embedNodeRuntime(nodePlatform, join(outDir, 'node-runtime'));

const launcherPath = join(binariesDir, binName);
writeLauncher(launcherPath, isWindows);
chmodSync(launcherPath, isWindows ? 0o644 : 0o755);

const baseLink = join(binariesDir, binBase);
rmSync(baseLink, { force: true });
cpSync(launcherPath, baseLink);
if (!isWindows) chmodSync(baseLink, 0o755);
if (isWindows) {
  cpSync(launcherPath, join(binariesDir, `${binBase}.exe`));
}

writeFileSync(join(outDir, '.target-triple'), `${targetTriple}\n`);

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
      'if [ ! -x "$NODE_BIN" ] || ! "$NODE_BIN" -v >/dev/null 2>&1; then',
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
    await downloadFileWithRetry(url, archivePath);

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
