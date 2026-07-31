/* ==========================================================================
   textures.js — every surface in this scene is generated at runtime.
   No image assets means no load spinner and no cache-busting on redeploy.
   ========================================================================== */

import * as THREE from 'three';

/* Deterministic PRNG (mulberry32) so the building looks identical on
   every visit — a monument that reshuffles itself isn't a monument. */
export function makeRandom(seed = 0x5eed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── value-noise fbm ─────────────────────────────────────────────────────
   A lattice of random values, bilinearly interpolated, summed over octaves.
   Tiles seamlessly because the lattice wraps with modulo. */
function fbmField(size, octaves, baseFreq, rnd) {
  const out = new Float32Array(size * size);
  let amp = 1;
  let norm = 0;
  let freq = baseFreq;

  for (let o = 0; o < octaves; o++) {
    const grid = Math.max(2, Math.round(freq));
    const lattice = new Float32Array(grid * grid);
    for (let i = 0; i < lattice.length; i++) lattice[i] = rnd();

    const cell = size / grid;
    for (let y = 0; y < size; y++) {
      const gy = y / cell;
      const y0 = Math.floor(gy) % grid;
      const y1 = (y0 + 1) % grid;
      const fy = gy - Math.floor(gy);
      const wy = fy * fy * (3 - 2 * fy); // smoothstep

      for (let x = 0; x < size; x++) {
        const gx = x / cell;
        const x0 = Math.floor(gx) % grid;
        const x1 = (x0 + 1) % grid;
        const fx = gx - Math.floor(gx);
        const wx = fx * fx * (3 - 2 * fx);

        const v00 = lattice[y0 * grid + x0];
        const v10 = lattice[y0 * grid + x1];
        const v01 = lattice[y1 * grid + x0];
        const v11 = lattice[y1 * grid + x1];

        const top = v00 + (v10 - v00) * wx;
        const bot = v01 + (v11 - v01) * wx;
        out[y * size + x] += (top + (bot - top) * wy) * amp;
      }
    }
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }

  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

/* ── concrete ────────────────────────────────────────────────────────────
   Board-formed concrete: fbm aggregate + faint horizontal pour lines +
   sparse dark pitting. Returns { map, bumpMap, roughnessMap }. */
export function createConcrete(size = 512, seed = 7, { seams = true } = {}) {
  const rnd = makeRandom(seed);
  /* Fine base frequency on purpose. Coarse fbm makes each tile individually
     recognisable, and on a 60 m slab the repeat then reads as a grid. */
  const grain = fbmField(size, 5, 8, rnd);
  const stain = fbmField(size, 3, 3, makeRandom(seed + 991));

  const albedo = new Uint8Array(size * size * 4);
  const rough = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    /* Board-form pour lines every ~1/6 of the tile. Walls want them; a floor
       does not — tiled 80× across a plaza they read as stripes, not concrete. */
    const band = Math.abs(Math.sin((y / size) * Math.PI * 6));
    const seam = seams ? Math.pow(1 - band, 30) * 0.085 : 0;

    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const g = grain[i];
      const s = stain[i];

      /* base luminance: mid grey, mottled, darkened by stains and seams */
      /* Mottle amplitude is deliberately low. Higher values look like
         camouflage once the surface is actually lit. */
      let l = 0.64 + (g - 0.5) * 0.17 + (s - 0.5) * 0.07 - seam;

      /* sparse pitting — small, dark, rare */
      if (g > 0.86 && s > 0.55) l -= 0.22;

      l = Math.min(1, Math.max(0.06, l));
      const v = (l * 255) | 0;

      const j = i * 4;
      albedo[j] = v;
      /* barely warm — matches --color-void's hint of warmth without letting
         the whole building drift brown */
      albedo[j + 1] = (v * 0.996) | 0;
      albedo[j + 2] = (v * 0.986) | 0;
      albedo[j + 3] = 255;

      /* rougher where darker/pitted, so highlights only catch smooth areas */
      const r = Math.min(255, Math.max(0, ((0.80 + (1 - l) * 0.20) * 255) | 0));
      rough[j] = rough[j + 1] = rough[j + 2] = r;
      rough[j + 3] = 255;
    }
  }

  const map = new THREE.DataTexture(albedo, size, size, THREE.RGBAFormat);
  map.colorSpace = THREE.SRGBColorSpace;
  const roughnessMap = new THREE.DataTexture(rough, size, size, THREE.RGBAFormat);

  for (const t of [map, roughnessMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 8;
    t.needsUpdate = true;
  }

  return { map, roughnessMap, bumpMap: map };
}

/* ── gradient sheet (light shafts) ──────────────────────────────────────
   Bright at v=1, gone by v=0, with soft horizontal falloff so the edges of
   the quad never show. */
export function createShaftTexture(w = 64, h = 256) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');

  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0.00, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.28, 'rgba(226,230,234,0.52)');
  g.addColorStop(0.65, 'rgba(200,204,209,0.16)');
  g.addColorStop(1.00, 'rgba(200,204,209,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  /* feather the left/right edges */
  const side = ctx.createLinearGradient(0, 0, w, 0);
  side.addColorStop(0.00, 'rgba(0,0,0,1)');
  side.addColorStop(0.22, 'rgba(0,0,0,0)');
  side.addColorStop(0.78, 'rgba(0,0,0,0)');
  side.addColorStop(1.00, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = side;
  ctx.fillRect(0, 0, w, h);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ── radial pool (where a shaft lands on the floor) ─────────────────── */
export function createPoolTexture(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const r = size / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0.00, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.24, 'rgba(226,230,234,0.42)');
  g.addColorStop(0.58, 'rgba(200,204,209,0.12)');
  g.addColorStop(1.00, 'rgba(200,204,209,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ── engraved lettering ─────────────────────────────────────────────────
   Light-etched inscription on stone: text drawn in near-white on
   transparent, used as an additive/emissive decal. */
export function createInscription(text, {
  width = 512,
  height = 256,
  font = '600 148px "EB Garamond", Georgia, serif',
  tracking = 0.06,
  color = 'rgba(243,237,224,0.92)',
} = {}) {
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  const ctx = c.getContext('2d');
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  /* manual tracking — canvas letterSpacing is not universally supported */
  const chars = [...text];
  const gap = tracking * parseInt(font.match(/(\d+)px/)?.[1] ?? 100, 10);
  const widths = chars.map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + gap * (chars.length - 1);

  let x = width / 2 - total / 2;
  ctx.shadowColor = 'rgba(226,230,234,0.55)';
  ctx.shadowBlur = 18;
  ctx.fillStyle = color;
  for (let i = 0; i < chars.length; i++) {
    ctx.fillText(chars[i], x + widths[i] / 2, height / 2);
    x += widths[i] + gap;
  }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
