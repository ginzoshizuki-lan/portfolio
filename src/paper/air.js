/* ==========================================================================
   air.js — the air in the room: drifting paper dust, grain, and ripples.

   This replaces three full-viewport DOM layers (two `mix-blend-mode: screen`
   dust plates, one `overlay` grain). Those cost a median 37.7ms per frame
   while scrolling — the compositor had to re-blend the whole viewport every
   time anything moved, and one of them carried a `filter: blur()` on top.
   One additive WebGL pass does the same work on the GPU, never touches
   layout, and is the only place a ripple can live.

   Raw WebGL on purpose: pulling three.js in here would add ~133kB gzipped to
   a page whose entire script is currently ~1kB.
   ========================================================================== */

const VERT = `
attribute vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }
`;

/* Ripples are passed as a flat array of vec4(x, y, age, strength). Eight is
   plenty: they live under a second and taps do not arrive that fast. */
const MAX_RIPPLES = 8;

const FRAG = `
precision highp float;

uniform vec2  uRes;
uniform float uTime;
uniform float uScroll;      // 0..1 through the document
uniform vec2  uPointer;     // in clip-ish 0..1, y down
uniform float uPointerOn;
uniform sampler2D uDust1;
uniform sampler2D uDust2;
uniform vec4  uRipples[${MAX_RIPPLES}];

/* Cheap hash noise for the film grain, so the grain layer stops being a
   separate composited DOM element. */
float hash(vec2 v) {
  return fract(sin(dot(v, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  uv.y = 1.0 - uv.y;
  float aspect = uRes.x / uRes.y;

  /* --- ripples ------------------------------------------------------- */
  vec2 push = vec2(0.0);
  float crest = 0.0;

  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    vec4 r = uRipples[i];
    if (r.w <= 0.0) continue;
    vec2 d = (uv - r.xy) * vec2(aspect, 1.0);
    float dist = length(d);
    float age = r.z;
    /* An expanding ring: the wave front travels outward, the whole thing
       fades with age, and it dies off with distance so the far corners of a
       big screen stay still. */
    float front = dist - age * 0.55;
    float wave = sin(front * 34.0) * exp(-abs(front) * 9.0);
    float life = exp(-age * 2.6) * r.w;
    push += normalize(d + 1e-5) * wave * life * 0.05;
    crest += abs(wave) * life;
  }

  /* A soft, permanent swell under the cursor, so the air reacts before you
     even click. */
  vec2 pd = (uv - uPointer) * vec2(aspect, 1.0);
  float pull = exp(-length(pd) * 5.0) * uPointerOn;
  push += normalize(pd + 1e-5) * pull * 0.012 * sin(uTime * 1.2);

  /* --- dust ---------------------------------------------------------- */
  /* Both layers drift on bounded curves rather than scrolling UVs: these are
     photographs, their edges do not tile, and anything unbounded eventually
     walks past the frame and shows a seam. Bounded means always moving and
     never repeating — which is what the hero needed anyway. */
  vec2 d1 = uv * 0.92 + vec2(
    sin(uTime * 0.035) * 0.02,
    cos(uTime * 0.028) * 0.02 - uScroll * 0.06
  ) + push;
  vec2 d2 = uv * 0.78 + vec2(
    cos(uTime * 0.024) * 0.035,
    sin(uTime * 0.019) * 0.03 - uScroll * 0.13
  ) + push * 1.7;

  vec3 near = texture2D(uDust1, clamp(d1, 0.0, 1.0)).rgb;
  vec3 far  = texture2D(uDust2, clamp(d2, 0.0, 1.0)).rgb;

  vec3 col = near * 0.16 + far * 0.10;

  /* The crest picks up a little extra light so a tap reads as a wave through
     the dust rather than as a smear. */
  col += vec3(0.85, 0.83, 0.78) * crest * 0.10;

  /* Grain, folded in from what used to be its own blended layer. */
  float g = hash(gl_FragCoord.xy + fract(uTime) * 91.0) - 0.5;
  col += g * 0.030;

  col = max(col, 0.0);

  /* Alpha has to track the light, not sit at 1.0. The canvas is composited
     over the document, so an opaque alpha paints a black sheet over the whole
     page — which is exactly what it did. Keyed to luminance and premultiplied,
     source-over compositing comes out very close to additive at these faint
     values, and the page shows through everywhere the dust is not. */
  float lum = max(col.r, max(col.g, col.b));
  gl_FragColor = vec4(col, clamp(lum * 2.2, 0.0, 1.0));
}
`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.warn('air: shader failed', gl.getShaderInfoLog(s));
    return null;
  }
  return s;
}

function loadTexture(gl, url) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  /* One warm pixel until the real thing arrives, so the first frames are not
     a black flash. */
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
    new Uint8Array([12, 10, 6, 255]));
  const img = new Image();
  img.onload = () => {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    /* CLAMP because these are NPOT photographs; the UVs above stay inside
       0..1 so clamping never shows. */
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  };
  img.src = url;
  return tex;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @returns {{ripple(x:number,y:number,strength?:number):void, setScroll(p:number):void, destroy():void}|null}
 */
export function createAir(canvas) {
  const gl = canvas.getContext('webgl', {
    alpha: true, antialias: false, depth: false, stencil: false,
    premultipliedAlpha: true, powerPreference: 'low-power',
  });
  if (!gl) return null;

  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;

  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn('air: link failed', gl.getProgramInfoLog(prog));
    return null;
  }
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const u = (n) => gl.getUniformLocation(prog, n);
  const uRes = u('uRes'), uTime = u('uTime'), uScroll = u('uScroll');
  const uPointer = u('uPointer'), uPointerOn = u('uPointerOn');
  const uRipples = u('uRipples');

  gl.uniform1i(u('uDust1'), 0);
  gl.uniform1i(u('uDust2'), 1);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, loadTexture(gl, '/paper/dust01.webp'));
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, loadTexture(gl, '/paper/dust02.webp'));

  /* No in-canvas blending and no clear: the draw is one full-screen triangle
     that writes every pixel every frame. Leaving BLEND on with ONE,ONE and no
     clear accumulated frame over frame until the canvas went solid. */
  gl.disable(gl.BLEND);

  const coarse = matchMedia('(pointer: coarse)').matches;
  /* Fill rate is the whole cost here, so resolution is the only dial worth
     turning. Full DPR on a phone would triple the work for an effect nobody
     can see at that density. */
  const dpr = Math.min(window.devicePixelRatio || 1, coarse ? 1 : 1.5);

  function resize() {
    const w = Math.round(window.innerWidth * dpr);
    const h = Math.round(window.innerHeight * dpr);
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w; canvas.height = h;
    gl.viewport(0, 0, w, h);
    gl.uniform2f(uRes, w, h);
  }
  window.addEventListener('resize', resize, { passive: true });
  resize();

  /* ── State ─────────────────────────────────────────────────────────── */

  const ripples = new Float32Array(MAX_RIPPLES * 4);
  let head = 0;
  let scroll = 0;
  let pointer = [0.5, 0.5];
  let pointerOn = 0;
  let running = true;
  let last = performance.now();

  function ripple(x, y, strength = 1) {
    const i = head * 4;
    ripples[i] = x; ripples[i + 1] = y; ripples[i + 2] = 0; ripples[i + 3] = strength;
    head = (head + 1) % MAX_RIPPLES;
  }

  addEventListener('pointermove', (e) => {
    pointer = [e.clientX / window.innerWidth, e.clientY / window.innerHeight];
    pointerOn = 1;
  }, { passive: true });
  addEventListener('pointerleave', () => { pointerOn = 0; }, { passive: true });
  addEventListener('pointerdown', (e) => {
    ripple(e.clientX / window.innerWidth, e.clientY / window.innerHeight, 1);
  }, { passive: true });

  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    for (let i = 0; i < MAX_RIPPLES; i++) {
      const b = i * 4;
      if (ripples[b + 3] <= 0) continue;
      ripples[b + 2] += dt;
      if (ripples[b + 2] > 2.2) ripples[b + 3] = 0;   // retire
    }

    gl.uniform1f(uTime, now * 0.001);
    gl.uniform1f(uScroll, scroll);
    gl.uniform2f(uPointer, pointer[0], pointer[1]);
    gl.uniform1f(uPointerOn, pointerOn);
    gl.uniform4fv(uRipples, ripples);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  requestAnimationFrame(frame);

  return {
    ripple,
    setScroll(p) { scroll = p; },
    destroy() { running = false; },
  };
}
