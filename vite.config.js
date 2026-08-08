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
    /* Three takes on the same content, built together so they can be compared
       from one server instead of by switching branches:
         /             architectural flythrough (what is live today)
         /gallery.html Lens Space — the fluid gallery
         /paper.html   Paper Space — paper, type and a long quiet scroll */
    rollupOptions: {
      input: {
        main: resolve(here, 'index.html'),
        gallery: resolve(here, 'gallery.html'),
        paper: resolve(here, 'paper.html'),
      },
    },
  },
});
