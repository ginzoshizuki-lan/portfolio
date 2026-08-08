import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  base: './',
  /* host: true binds every interface, so the dev server is reachable from a
     phone on the same Wi-Fi — the only way to review this on real hardware.
     Vite prints the LAN URL on startup. */
  server: { host: true, port: 5178, strictPort: false },
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    /* Two entries while the gallery is on trial: / is the shipped flythrough,
       /gallery.html is the lens space. Comparing them side by side is the
       whole point of the branch. */
    rollupOptions: {
      input: {
        main: resolve(here, 'index.html'),
        gallery: resolve(here, 'gallery.html'),
      },
    },
  },
});
