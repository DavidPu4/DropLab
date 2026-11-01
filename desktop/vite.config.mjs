import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('./renderer/', import.meta.url)),
  publicDir: fileURLToPath(new URL('../public/', import.meta.url)),
  base: '/',
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('./app/renderer/', import.meta.url)),
    emptyOutDir: true, sourcemap: false, target: 'es2022',
  },
});
