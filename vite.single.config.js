import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

/* A separate build purely so `build:single` has something it can fold into one
   file. The main build has three entries, and Vite splits what they share —
   three.js came out as its own chunk — so the flythrough page ended up
   referencing four scripts instead of one. Built alone there is nothing to
   share and nothing to split. */
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    outDir: 'dist-single-build',
    emptyOutDir: true,
    rollupOptions: {
      input: { flythrough: resolve(here, 'flythrough.html') },
    },
  },
});
