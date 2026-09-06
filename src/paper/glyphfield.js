/* ==========================================================================
   glyphfield.js — the headline, made of particles that read two ways.

   The hero used to be a photograph of a forme with the headline set on top
   of it. This replaces both with one point cloud.

   Every particle carries two x-coordinates: one from the face "Another /
   reading", one from the face "was always / possible." — sampled on the SAME
   scanline. The point is placed at (xA, y, xB). Under orthographic
   projection, rotating the cloud about its vertical axis by 90 degrees swaps
   which coordinate lands on screen:

       x' = x·cos(a) + z·sin(a)      a=0   -> x' = xA   (face A)
                                     a=90  -> x' = xB   (face B)

   So the two readings are exact, not an approximation fitted by hand. No
   particle moves; only the angle does. That is the whole argument of the
   page — another reading was always possible — stated as geometry.

   Raw WebGL, one draw call, for the same reason air.js is: three.js would
   add ~133kB gzipped to a page whose script is measured in single-digit kB.
   Positions are static and uploaded once; rotation, pointer repulsion and
   the metallic shimmer are all computed in the vertex shader, so the CPU
   does nothing per frame but set six uniforms.
   ========================================================================== */

const VERT = `
attribute vec3 aPos;      /* (xA, y, xB) in CSS px, relative to the pivot   */
attribute vec3 aSeed;     /* .x = shimmer phase, .y = size, .z = ownership  */

uniform vec2  uRes;       /* drawing buffer size, device px                 */
uniform vec2  uOrigin;    /* pivot in CSS px, relative to the canvas        */
uniform float uAngle;
uniform float uDPR;
uniform vec2  uPointer;   /* CSS px, relative to the canvas                 */
uniform float uForce;     /* 0..1, decays after the pointer leaves          */
uniform float uPS;

varying float vB;
varying float vVis;

void main() {
  float c = cos(uAngle), s = sin(uAngle);
  float x =  aPos.x * c + aPos.z * s;
  float z = -aPos.x * s + aPos.z * c;

  vec2 p = uOrigin + vec2(x, aPos.y);

  /* Repulsion happens in screen space, after the rotation, so the cloud
     always breaks away from the cursor rather than from some position it
     held at angle zero. */
  vec2  d    = p - uPointer;
  float dist = length(d);
  float R    = 190.0;
  if (uForce > 0.001 && dist < R) {
    float k = (R - dist) / R;
    /* Each particle gets its own amplitude. With one shared amplitude every
       point inside the radius lands at nearly the same distance from the
       cursor, and the disturbance reads as a hole punched with a compass —
       a hard, perfectly circular rim with all the ink piled on it. */
    float amp = 74.0 * (0.45 + 1.15 * aSeed.y);
    p += normalize(d + vec2(0.0001)) * pow(k, 1.5) * amp * uForce;
  }

  vec2 clip = (p / uRes * uDPR) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);

  /* Metal, cheaply: each particle has its own phase, so turning the cloud
     makes the field glitter instead of fading uniformly. Depth contributes
     only a little — leaning on z would print a ghost of the other word into
     the face you are supposed to be reading. */
  float shimmer = 0.58 + 0.42 * sin(uAngle * 2.0 + aSeed.x * 6.2831);
  float depth   = 0.92 + 0.08 * (z / 400.0);

  /* A particle's y is shared by both faces, so a scanline that only one word
     needs — the descender of the y in "always", which "Another" has nothing
     on — cannot simply be dropped without amputating that letter. Those
     particles are kept and faded out while the face they do not belong to is
     the one being read. aSeed.z: 0 both, +1 face A only, -1 face B only. */
  float toB = smoothstep(0.0, 1.0, sin(uAngle));
  vVis = 1.0;
  if (aSeed.z >  0.5) vVis = 1.0 - toB;
  if (aSeed.z < -0.5) vVis = toB;

  vB = clamp(shimmer * depth, 0.10, 1.0);

  gl_PointSize = uPS * uDPR * (0.85 + 0.30 * aSeed.y);
}
`;

const FRAG = `
precision mediump float;
varying float vB;
varying float vVis;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.16, length(q));
  if (a < 0.01) discard;
  vec3 silver = mix(vec3(0.44, 0.48, 0.55), vec3(0.94, 0.96, 1.0), vB);
  gl_FragColor = vec4(silver, a * (0.30 + 0.70 * vB) * vVis);
}
`;

const FACE_A = ['Another', 'reading'];
const FACE_B = ['was always', 'possible.'];

/* Sampling grid, in CSS px of the rendered type — deliberately not scaled to
   the type size. A fixed step means constant points-per-screen-pixel at every
   viewport: the cloud looks equally dense on a phone and on a wide monitor,
   and the count falls out of how big the headline actually is (~13k at 97px,
   ~24k at the 128px cap). Stepping by 2 was the first attempt and dropped to
   a quarter of the points the moment the real headline came in under the
   prototype's size — the type read as a thin dotted outline. */
const ROW_STEP = 1;
const COL_STEP = 1;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.warn('[glyphfield]', gl.getShaderInfoLog(s));
    return null;
  }
  return s;
}

/* Rasterise one face into an offscreen canvas and return, per scanline, the
   x positions that are inside a glyph. */
function sampleFace(lines, font, lineHeight, w, h, colStep, rowStep) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#fff';
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.font = font;

  const top = h / 2 - (lines.length - 1) * lineHeight / 2;
  lines.forEach((line, i) => g.fillText(line, 0, top + i * lineHeight));

  const data = g.getImageData(0, 0, w, h).data;
  const rows = [];
  for (let y = 0; y < h; y += rowStep) {
    const xs = [];
    const base = y * w * 4;
    for (let x = 0; x < w; x += colStep) {
      if (data[base + x * 4] > 128) xs.push(x);
    }
    rows.push(xs);
  }
  return rows;
}

/* Stretch a scanline's x list to exactly n samples. The two faces almost
   never have the same amount of ink on a given line, and the thinner one has
   to be padded rather than truncated — dropping points would punch holes in
   whichever word happened to be lighter. */
function resample(xs, n) {
  const out = new Array(n);
  if (xs.length === 1) { out.fill(xs[0]); return out; }
  for (let i = 0; i < n; i++) {
    out[i] = xs[Math.round(i * (xs.length - 1) / (n - 1))];
  }
  return out;
}

/**
 * @param {HTMLCanvasElement} canvas  sits inside the hero, pointer-events none
 * @param {HTMLElement}       anchor  the element the cloud should replace
 * @returns {null | {count:number, destroy:Function}}
 */
export function createGlyphField(canvas, anchor) {
  const gl = canvas.getContext('webgl', {
    alpha: true, antialias: false, premultipliedAlpha: false, depth: false,
    /* Off in normal use — keeping the buffer around costs a copy every frame
       and nothing on the page reads it back. On under #perf because a
       screenshot taken from outside the page otherwise catches the canvas
       after the swap and comes back empty: the hero looks like it never
       drew, which is exactly how this was first mis-diagnosed. */
    preserveDrawingBuffer: location.hash === '#perf'
  });
  if (!gl) return null;

  const prog = gl.createProgram();
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn('[glyphfield]', gl.getProgramInfoLog(prog));
    return null;
  }
  gl.useProgram(prog);

  const U = {};
  for (const n of ['uRes', 'uOrigin', 'uAngle', 'uDPR', 'uPointer', 'uForce', 'uPS']) {
    U[n] = gl.getUniformLocation(prog, n);
  }
  const posBuf = gl.createBuffer();
  const seedBuf = gl.createBuffer();
  const aPos = gl.getAttribLocation(prog, 'aPos');
  const aSeed = gl.getAttribLocation(prog, 'aSeed');

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  gl.clearColor(0, 0, 0, 0);

  let dpr = 1, count = 0, origin = [0, 0], pointSize = 1.9;

  /* ── build ─────────────────────────────────────────────────────────── */

  function build() {
    const cs = getComputedStyle(anchor);
    const family = cs.fontFamily;
    const weight = cs.fontWeight || '400';
    const box = anchor.getBoundingClientRect();
    const hero = canvas.getBoundingClientRect();

    /* Fit to the width the headline already owns, capped at the size the
       stylesheet asked for. The two faces must share one size or the
       scanlines stop lining up. */
    let size = parseFloat(cs.fontSize) || 96;
    const probe = document.createElement('canvas').getContext('2d');
    const widest = (px) => {
      probe.font = `${weight} ${px}px ${family}`;
      return Math.max(
        ...FACE_A.map((l) => probe.measureText(l).width),
        ...FACE_B.map((l) => probe.measureText(l).width)
      );
    };
    const avail = Math.max(160, box.width);
    const w0 = widest(size);
    if (w0 > avail) size = Math.floor(size * avail / w0);

    /* On a phone the headline bottoms out at the clamp's 44px floor, and a
       one-CSS-pixel grid over type that small yields about a quarter of the
       particles it does on a desktop — measured, the words came out thin and
       faint. Rasterise at double size there and halve the coordinates, which
       is the same as sampling on a half-pixel grid. */
    const ss = size < 72 ? 2 : 1;
    const font = `${weight} ${size * ss}px ${family}`;
    const lh = size * ss * 1.04;
    const sw = Math.ceil(widest(size * ss)) + 8;
    const sh = Math.ceil(lh * 2 + size * ss * 1.2);

    const colStep = COL_STEP;
    const rowStep = ROW_STEP;

    const A = sampleFace(FACE_A, font, lh, sw, sh, colStep, rowStep);
    const B = sampleFace(FACE_B, font, lh, sw, sh, colStep, rowStep);

    /* When a scanline exists in only one face, the particles still need some
       x for the other face so they have somewhere to travel through. Borrow
       it from the nearest line that face does have ink on; they are invisible
       while that face is being read, so the borrowed value never shows. */
    const nearest = (rows, r) => {
      for (let d = 1; d < rows.length; d++) {
        if (rows[r - d] && rows[r - d].length) return rows[r - d];
        if (rows[r + d] && rows[r + d].length) return rows[r + d];
      }
      return null;
    };
    const pick = (xs) => xs[(Math.random() * xs.length) | 0];

    const pos = [], seed = [];
    const cx = sw / 2, cy = sh / 2;
    for (let r = 0; r < A.length; r++) {
      const a = A[r], b = B[r];
      if (!a.length && !b.length) continue;

      let ra, rb, own, n;
      if (a.length && b.length) {
        n = Math.max(a.length, b.length);
        ra = resample(a, n); rb = resample(b, n); own = 0;
      } else if (a.length) {
        const other = nearest(B, r);
        if (!other) continue;
        n = a.length; ra = a; rb = a.map(() => pick(other)); own = 1;
      } else {
        const other = nearest(A, r);
        if (!other) continue;
        n = b.length; rb = b; ra = b.map(() => pick(other)); own = -1;
      }

      const y = r * rowStep - cy;
      for (let i = 0; i < n; i++) {
        /* A half-step of vertical jitter. Without it the scanlines read as
           horizontal banding once the cloud turns. */
        const jy = (Math.random() - 0.5) * rowStep;
        /* Back down into CSS px — the shader works in the page's units. */
        pos.push((ra[i] - cx) / ss, (y + jy) / ss, (rb[i] - cx) / ss);
        seed.push(Math.random(), Math.random(), own);
      }
    }
    count = seed.length / 3;

    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, seedBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(seed), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(aSeed);
    gl.vertexAttribPointer(aSeed, 3, gl.FLOAT, false, 0, 0);

    /* The cloud sits where the headline sat, and turns about its own centre
       so it spreads symmetrically instead of sweeping off to one side. */
    /* cx is in the rasteriser's units, the box is in CSS px — divide, or the
       cloud sits half its own width to the right of the headline it replaced. */
    origin = [box.left - hero.left + cx / ss, box.top - hero.top + box.height / 2];
    pointSize = size > 84 ? 1.9 : 1.6;

    if (location.hash === '#perf') {
      canvas.dataset.gf = JSON.stringify({
        count, size: +size.toFixed(2), sw, sh, avail: +avail.toFixed(1),
        colStep, rowStep, family
      });
    }
  }

  function syncCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    const w = Math.floor(r.width * dpr), h = Math.floor(r.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  /* The cloud is a rasterisation of the headline, so it is only correct for
     the layout that existed when it was built. Rebuilding on window resize
     alone is not enough: the headline's size is a clamp() on viewport width,
     its box is measured in `ch`, and the web font arrives after first paint.
     Any of those can settle after this module loads, and the first build then
     stands for the rest of the session at the wrong size — measured once at
     44px, the clamp's floor, because the viewport was momentarily narrow.
     A ResizeObserver on the headline itself catches all of them. */
  let pending = 0;
  function scheduleBuild() {
    if (pending) return;
    pending = requestAnimationFrame(() => { pending = 0; syncCanvas(); build(); });
  }

  const ro = typeof ResizeObserver === 'function'
    ? new ResizeObserver(scheduleBuild) : null;
  if (ro) ro.observe(anchor);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(scheduleBuild).catch(() => {});
  }

  /* ── rotation schedule ─────────────────────────────────────────────────
     Not a constant spin. A visitor arriving mid-turn would meet an
     unreadable smear, so the cloud dwells on each face and crosses between
     them quickly. easeInOut is fast through the middle, which is exactly
     where the two words are illegible. */
  const HOLD_A = 2400, TURN = 2400, HOLD_B = 2800;
  const CYCLE = HOLD_A + TURN + HOLD_B + TURN;
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  /* `?gf=<degrees>` pins the cloud so a still can be taken of one face. Only
     honoured alongside #perf, and the only way to photograph face B: the turn
     is on a wall-clock schedule that a capture tool cannot aim at. */
  const pinned = location.hash === '#perf'
    ? parseFloat(new URLSearchParams(location.search).get('gf'))
    : NaN;

  function angleAt(ms) {
    if (!Number.isNaN(pinned)) return pinned * Math.PI / 180;
    const t = ms % CYCLE;
    if (t < HOLD_A) return 0;
    if (t < HOLD_A + TURN) return easeInOut((t - HOLD_A) / TURN) * Math.PI / 2;
    if (t < HOLD_A + TURN + HOLD_B) return Math.PI / 2;
    return (1 - easeInOut((t - HOLD_A - TURN - HOLD_B) / TURN)) * Math.PI / 2;
  }

  /* ── loop ──────────────────────────────────────────────────────────── */

  let pointer = [-9999, -9999], force = 0, raf = 0, t0 = 0, live = true;

  function onMove(e) {
    const r = canvas.getBoundingClientRect();
    pointer = [e.clientX - r.left, e.clientY - r.top];
    force = 1;
  }
  function onLeave() { force = 0; }

  addEventListener('pointermove', onMove, { passive: true });
  addEventListener('pointerleave', onLeave, { passive: true });
  addEventListener('resize', scheduleBuild, { passive: true });

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!t0) t0 = now;
    if (!live) return;
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform2f(U.uOrigin, origin[0], origin[1]);
    gl.uniform1f(U.uAngle, angleAt(now - t0));
    gl.uniform1f(U.uDPR, dpr);
    gl.uniform2f(U.uPointer, pointer[0], pointer[1]);
    gl.uniform1f(U.uForce, force);
    gl.uniform1f(U.uPS, pointSize);
    gl.drawArrays(gl.POINTS, 0, count);
    force *= 0.958;              /* letting go re-assembles over ~1s */
  }

  syncCanvas();
  build();
  raf = requestAnimationFrame(frame);

  return {
    get count() { return count; },
    /* The hero is one screen tall; there is no reason to keep drawing it
       from halfway down the document. */
    setLive(v) {
      if (v === live) return;
      live = v;
      if (!v) gl.clear(gl.COLOR_BUFFER_BIT);
    },
    destroy() {
      cancelAnimationFrame(raf);
      removeEventListener('pointermove', onMove);
      removeEventListener('pointerleave', onLeave);
      removeEventListener('resize', scheduleBuild);
      if (ro) ro.disconnect();
      if (pending) cancelAnimationFrame(pending);
    }
  };
}
