import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * The content script is built separately: content scripts can't be ES
 * modules, so it must be one self-contained classic script.
 */
export default defineConfig(({ mode }) => ({
  build: {
    target: 'es2023',
    outDir: 'dist',
    emptyOutDir: false,
    minify: mode !== 'e2e',
    lib: {
      entry: fileURLToPath(new URL('./src/content/index.ts', import.meta.url)),
      formats: ['iife'],
      name: 'PassVaultifyContent',
      fileName: () => 'content.js',
    },
  },
}));
