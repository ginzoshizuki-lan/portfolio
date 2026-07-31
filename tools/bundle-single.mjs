/* ==========================================================================
   bundle-single.mjs — fold dist/ into one double-clickable HTML file.

   `npm run build` output needs a server: ES module scripts and image files
   are both blocked over file://. This inlines the CSS, converts the bundled
   module into a classic script (it has no import/export left after bundling),
   and swaps the portrait for a data URI. Result: dist-single/index.html runs
   from the desktop with no toolchain.

   Run via `npm run build:single`.
   ========================================================================== */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const out = join(root, 'dist-single');

const assets = await readdir(join(dist, 'assets'));
const jsFile = assets.find((f) => f.endsWith('.js'));
const cssFile = assets.find((f) => f.endsWith('.css'));
if (!jsFile || !cssFile) throw new Error('run `npm run build` first');

let html = await readFile(join(dist, 'index.html'), 'utf8');
const js = await readFile(join(dist, 'assets', jsFile), 'utf8');
const css = await readFile(join(dist, 'assets', cssFile), 'utf8');

/* A classic <script> cannot contain module syntax. If the bundle still has
   any, fail loudly rather than shipping a file that dies in the console. */
const moduleSyntax = /^\s*(import|export)[\s{*]/m.exec(js);
if (moduleSyntax) {
  throw new Error(`bundle still contains module syntax: ${moduleSyntax[0].trim()}`);
}
if (js.includes('import.meta')) {
  throw new Error('bundle references import.meta, which classic scripts cannot use');
}

const portrait = await readFile(join(root, 'public', 'portrait_ginzo.jpg'));
const portraitURI = `data:image/jpeg;base64,${portrait.toString('base64')}`;

/* Strip the built references, then re-inject inline.
   Every replacement goes through a FUNCTION, never a string: minified
   three.js contains `$&` and '$`' sequences, and String.replace expands
   those in a string replacement — which splices the surrounding document
   into the middle of the bundle and corrupts it. */
const inject = (s) => () => s;

html = html
  .replace(new RegExp(`\\s*<link[^>]+assets/${cssFile}[^>]*>`, 'g'), '')
  .replace(new RegExp(`\\s*<script[^>]+assets/${jsFile}[^>]*></script>`, 'g'), '')
  .replace('</head>', inject(`<style>${css}</style>\n</head>`))
  .replace('</body>', inject(`<script>\n${js.replace(/<\/script/gi, '<\\/script')}\n</script>\n</body>`));

/* Patch the portrait path once the script is inline. The minifier may have
   rewritten the literal as a template string, so replace the bare path and
   leave whatever quoting is around it alone — base64 contains nothing that
   needs escaping in any of the three string forms. */
/* Match an optional leading "./" or "/" as well as the bare name: with
   base:'./' Vite rewrites the src to "./portrait_ginzo.jpg", and replacing
   only "/portrait_ginzo.jpg" left the dot behind, producing the invalid src
   ".data:image/jpeg;base64,..." and a broken image. */
const before = html.length;
html = html.replace(/\.?\/?portrait_ginzo\.jpg/g, inject(portraitURI));
if (html.length === before) {
  throw new Error('portrait path not found in bundle — did the filename change?');
}
if (html.includes('.data:image')) {
  throw new Error('portrait data URI has a stray prefix — the src is broken');
}

/* Last line of defence: the output must parse as a classic script. */
const inline = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
try {
  new Function(inline);
} catch (err) {
  throw new Error(`inlined bundle does not parse: ${err.message}`);
}

await mkdir(out, { recursive: true });
await writeFile(join(out, 'index.html'), html, 'utf8');

const kb = (n) => `${(n / 1024).toFixed(0)} kB`;
console.log(`dist-single/index.html  ${kb(Buffer.byteLength(html))}  (portrait ${kb(portrait.length)} inlined)`);
