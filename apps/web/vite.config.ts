import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths, so the build works from any URL (GitHub Pages serves it under /<repo>/).
  base: './',
  build: { target: 'es2023' },
});
