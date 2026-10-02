import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const file = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * Emits manifest.json, taking the version from package.json. The e2e build
 * (vite build --mode e2e) also grants localhost access, so the automated tests
 * can fill a local page without the "allow" click a person would make.
 */
function manifest(mode: string): Plugin {
  return {
    name: 'passvaultify-manifest',
    generateBundle() {
      const json = JSON.parse(readFileSync(file('./manifest.json'), 'utf8')) as Record<
        string,
        unknown
      >;
      const pkg = JSON.parse(readFileSync(file('./package.json'), 'utf8')) as { version: string };
      json.version = pkg.version;
      if (mode === 'e2e') json.host_permissions = ['http://localhost/*', 'http://127.0.0.1/*'];
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.json',
        source: `${JSON.stringify(json, null, 2)}\n`,
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), manifest(mode)],
  base: './',
  build: {
    target: 'es2023',
    outDir: 'dist',
    emptyOutDir: true,
    // zxcvbn's dictionaries are one large chunk, loaded only when a master password is typed.
    chunkSizeWarningLimit: 1300,
    // Readable output in test builds makes a failing end-to-end run easier to debug.
    minify: mode !== 'e2e',
    rollupOptions: {
      input: {
        popup: file('./popup.html'),
        setup: file('./setup.html'),
        background: file('./src/background/index.ts'),
      },
      output: {
        // The service worker must sit at a fixed path named in the manifest.
        entryFileNames: (chunk) =>
          chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
      },
    },
  },
}));
