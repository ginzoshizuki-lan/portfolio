/* ==========================================================================
   halftone.js — draw the photographs as dots.

   What ships for each photograph is not a picture but a map: one greyscale
   pixel per halftone cell, seventy-seven across for a plate, written by
   tools/halftone.py. That map is the <img>'s src, so without this module the
   page still shows a soft, very small version of the picture in the right
   colour rather than a hole. This module reads the map back out, draws the
   dots at the size the image is actually displayed, and swaps the result in.

   Why not ship the dots as pixels: measured, the twenty photographs went from
   1,299kB to 2,868kB that way, even resized to their display size. A screen
   of dots is pure high-frequency detail and no lossy codec can hold it. The
   maps come to a few tens of kB and the page ends up lighter than before.

   One canvas is reused for every image and the result handed over as a blob,
   so at no point is there more than a single canvas of backing store alive —
   twenty canvases the size of these plates would be tens of megabytes.
   ========================================================================== */

/* Traditional single-screen angle. The map is a square lattice, but the dots
   are laid on a rotated one and the map sampled underneath it: on the square
   lattice the eye immediately finds the rows and it reads as a screen door
   rather than as print. */
const SCREEN_ANGLE = Math.PI / 4;

/* >1 so the brightest cells overlap into solid areas instead of leaving a
   permanent grid of gaps at full white. */
const DOT_GAIN = 1.3;

const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');
const probe = document.createElement('canvas');
const probeCtx = probe.getContext('2d', { willReadFrequently: true });

function readMap(img) {
  const cx = img.naturalWidth, cy = img.naturalHeight;
  if (!cx || !cy) return null;
  probe.width = cx; probe.height = cy;
  probeCtx.clearRect(0, 0, cx, cy);
  probeCtx.drawImage(img, 0, 0);
  return { cx, cy, data: probeCtx.getImageData(0, 0, cx, cy).data };
}

/* Bilinear, so the dot sizes vary smoothly across a gradient instead of
   stepping wherever the rotated grid crosses a cell boundary. */
function sample(map, u, v) {
  const { cx, cy, data } = map;
  const x = Math.min(cx - 1, Math.max(0, u - 0.5));
  const y = Math.min(cy - 1, Math.max(0, v - 0.5));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(cx - 1, x0 + 1), y1 = Math.min(cy - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const at = (px, py) => data[(py * cx + px) * 4];
  const top = at(x0, y0) * (1 - fx) + at(x1, y0) * fx;
  const bot = at(x0, y1) * (1 - fx) + at(x1, y1) * fx;
  return (top * (1 - fy) + bot * fy) / 255;
}

function displayWidth(img) {
  const own = img.getBoundingClientRect().width;
  if (own > 1) return own;
  const parent = img.parentElement;
  return parent ? parent.getBoundingClientRect().width : 0;
}

/* The map is read from one element and the dots are measured against
   another: once an image has been upgraded its own src is the dots, and
   re-reading it would screen the screen. */
function paint(mapImg, target) {
  const map = readMap(mapImg);
  if (!map) return false;

  const cssW = displayWidth(target);
  if (cssW < 2) return false;

  /* Capped at 1500: past that the canvas is only feeding pixels no screen is
     going to show, and the backing store grows with the square. */
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(Math.min(cssW * dpr, 1500));
  const h = Math.round(w * map.cy / map.cx);
  if (w < 2 || h < 2) return false;

  const perCell = w / map.cx;
  canvas.width = w; canvas.height = h;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = target.dataset.ink || '#d9d7d4';

  const cos = Math.cos(SCREEN_ANGLE), sin = Math.sin(SCREEN_ANGLE);
  const reach = Math.ceil(Math.hypot(w, h) / perCell / 2) + 1;
  const cxp = w / 2, cyp = h / 2;

  ctx.beginPath();
  for (let i = -reach; i <= reach; i++) {
    for (let j = -reach; j <= reach; j++) {
      const u = i * perCell, v = j * perCell;
      const x = u * cos - v * sin + cxp;
      const y = u * sin + v * cos + cyp;
      if (x < -perCell || x > w + perCell || y < -perCell || y > h + perCell) continue;
      const lum = sample(map, x / perCell, y / perCell);
      if (lum <= 0.004) continue;
      /* Area tracks brightness, not radius: using radius directly blows the
         midtones out into a flat white. */
      const r = (perCell / 2) * Math.sqrt(lum) * DOT_GAIN;
      if (r < 0.22) continue;
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
  }
  ctx.fill();
  return true;
}

/* One canvas is shared by every image, and toBlob is asynchronous. Painting
   the next image before the previous blob has been taken would hand the wrong
   picture to the wrong element, so renders are run one at a time. */
const queue = [];
let busy = false;

function pump() {
  if (busy) return;
  const job = queue.shift();
  if (!job) return;
  busy = true;
  if (!paint(job.map, job.target)) { busy = false; pump(); return; }
  canvas.toBlob((blob) => {
    if (blob) {
      const url = URL.createObjectURL(blob);
      const release = () => URL.revokeObjectURL(url);
      job.target.addEventListener('load', release, { once: true });
      job.target.addEventListener('error', release, { once: true });
      job.target.dataset.htWidth = String(Math.round(displayWidth(job.target)));
      job.target.src = url;
    }
    busy = false;
    pump();
  }, 'image/png');
}

function enqueue(map, target) {
  queue.push({ map, target });
  pump();
}

/**
 * Upgrade every <img data-ink> from its cell map to drawn dots.
 * @returns {{count: number}}
 */
export function paintHalftones() {
  const imgs = [...document.querySelectorAll('img[data-ink]')];
  /* Keep the map's address: after the swap the element points at a blob of
     dots and there is no way back to it. */
  const maps = new WeakMap();

  for (const img of imgs) {
    maps.set(img, img.getAttribute('src'));
    if (img.complete && img.naturalWidth) enqueue(img, img);
    else img.addEventListener('load', () => enqueue(img, img), { once: true });
  }

  /* Redraw only when the layout moved enough that the dots would be visibly
     stretched. Each redraw re-rasterises the set, so the threshold matters
     more than the debounce. */
  let timer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      for (const img of imgs) {
        const was = Number(img.dataset.htWidth || 0);
        const now = displayWidth(img);
        const src = maps.get(img);
        if (!was || now < 2 || !src) continue;
        if (Math.abs(now - was) / was < 0.2) continue;
        const fresh = new Image();
        fresh.onload = () => enqueue(fresh, img);
        fresh.src = src;
      }
    }, 320);
  }, { passive: true });

  return { count: imgs.length };
}
