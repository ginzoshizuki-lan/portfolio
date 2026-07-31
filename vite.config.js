import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  /* host: true binds every interface, so the dev server is reachable from a
     phone on the same Wi-Fi — the only way to review this on real hardware.
     Vite prints the LAN URL on startup. */
  server: { host: true, port: 5178, strictPort: false },
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
  },
});
