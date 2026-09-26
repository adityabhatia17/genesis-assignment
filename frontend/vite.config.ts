import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  worker: { format: 'es' },
  build: {
    sourcemap: true,
    manifest: true,
    // Monaco lives in the lazy workspace chunk and is large by nature; the entry-chunk budget is
    // enforced separately by scripts/check-bundle.mjs.
    chunkSizeWarningLimit: 6_000,
  },
});
