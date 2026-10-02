import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const page = (file: string) => fileURLToPath(new URL(file, import.meta.url));
const publicDir = page('./public');

/**
 * Content Security Policy for the built pages. Scripts, fonts and data come
 * only from this origin, nothing can be framed or posted anywhere, and no
 * plugin content runs. Styles allow inline because the dialog library sets
 * scroll-lock styles at runtime. Build-only: the dev server injects an inline
 * script for hot reload.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'passvaultify-csp',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
        injectTo: 'head-prepend',
      },
    ],
  };
}

/**
 * A service worker with the exact list of built files, so the app installs as
 * a PWA and opens offline. The cache name is a hash of that list: any change
 * ships a new worker, which the app offers to load with a "Reload" toast.
 */
function serviceWorker(): Plugin {
  return {
    name: 'passvaultify-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const copied = readdirSync(publicDir);
      const files = ['./', ...[...built, ...copied].sort()];
      const version = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12);
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: `// Generated at build time by vite.config.ts. Do not edit.
const CACHE = 'passvaultify-${version}';
const FILES = ${JSON.stringify(files)};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('passvaultify-') && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// The page asks the waiting worker to take over when the user clicks Reload.
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    // Pages: network first, so a new version is picked up; the cache when offline.
    event.respondWith(
      fetch(request).catch(() =>
        caches
          .match(request, { ignoreSearch: true })
          .then((hit) => hit || caches.match('./index.html')),
      ),
    );
    return;
  }
  // Built assets have content hashes in their names, so the cache is always right.
  event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
});
`,
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), contentSecurityPolicy(), serviceWorker()],
  // Relative asset paths, so the build works from any URL (GitHub Pages serves it under /<repo>/).
  base: './',
  build: {
    target: 'es2023',
    // zxcvbn's dictionaries are one large chunk, loaded only when a master password is typed.
    chunkSizeWarningLimit: 1300,
    rollupOptions: {
      input: { app: page('./index.html'), specimen: page('./specimen.html') },
    },
  },
});
