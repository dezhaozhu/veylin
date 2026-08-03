import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { existsSync } from 'node:fs';

// @caliper/viewer 真包通过 node_modules 软链接入(ln -s <caliper>/packages/viewer
// node_modules/@caliper/viewer);存在则打真 3D 查看器,否则落 shim 兜底。
const caliperViewerReal = fileURLToPath(
  new URL('../../node_modules/@caliper/viewer/dist/index.js', import.meta.url),
);
const caliperViewer = existsSync(caliperViewerReal)
  ? caliperViewerReal
  : fileURLToPath(new URL('./src/shims/caliper-viewer.tsx', import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Ensure a single React copy so AG-Grid's hooks share the app's
    // React instance (otherwise: "Invalid hook call / more than one copy").
    dedupe: ['react', 'react-dom', 'three'],
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@/vendor/assistant-ui': fileURLToPath(
        new URL('./src/vendor/assistant-ui/index.ts', import.meta.url),
      ),
      'secure-json-parse': fileURLToPath(
        new URL('./src/shims/secure-json-parse.ts', import.meta.url),
      ),
      '@caliper/viewer': caliperViewer,
    },
  },
  optimizeDeps: {
    include: ['assistant-stream'],
  },
  build: {
    // Keep esbuild for CSS minification (safe override, harmless here).
    cssMinify: 'esbuild',
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/health': {
        target: process.env.VITE_API_URL ?? 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      '/api': {
        target: process.env.VITE_API_URL ?? 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
});
