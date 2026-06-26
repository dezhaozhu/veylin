import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Ensure a single React copy so react-data-grid's hooks share the app's
    // React instance (otherwise: "Invalid hook call / more than one copy").
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'secure-json-parse': fileURLToPath(
        new URL('./src/shims/secure-json-parse.ts', import.meta.url),
      ),
    },
  },
  optimizeDeps: {
    include: ['assistant-stream', 'react-data-grid'],
  },
  build: {
    // Vite 8 lightningcss has a bug minifying light-dark() (used by
    // react-data-grid styles). Use esbuild for CSS minification instead.
    cssMinify: 'esbuild',
  },
  server: {
    port: 5174,
    proxy: {
      '/health': {
        target: process.env.VITE_API_URL ?? 'http://localhost:8787',
        changeOrigin: true,
      },
      '/api': {
        target: process.env.VITE_API_URL ?? 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
});
