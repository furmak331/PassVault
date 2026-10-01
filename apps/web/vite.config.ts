import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const page = (file: string) => fileURLToPath(new URL(file, import.meta.url));

export default defineConfig({
  plugins: [react()],
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
