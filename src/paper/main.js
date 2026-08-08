/* ==========================================================================
   main.js — scroll behaviour for the paper build.

   The loop never reads layout. Every position is measured once into document
   space and then offset by scrollY, because the first version read
   getBoundingClientRect() for two dozen movers and wrote transforms in the
   same pass — a layout invalidated and recomputed on every single frame.
   Reveals stay with IntersectionObserver; they fire once and cost nothing.
   ========================================================================== */

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── Clock ────────────────────────────────────────────────────────────── */

const clock = document.getElementById('c-kyoto');
const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
function tickClock() { clock.textContent = fmt.format(new Date()); }
tickClock();
setInterval(tickClock, 1000);

document.getElementById('yr').textContent = new Date().getFullYear();

/* ── Split the display type into characters ───────────────────────────── */

/* The ripple has to move the words, not just the dust behind them, and the
   only way to make a line undulate is to move its letters independently.
   Two rules make that safe, both learned the hard way:

   1. Every letter goes inside a word wrapper. A bare inline-block letter is an
      atomic inline box, and the browser will happily break a line between any
      two of them — "Registers" came out as "Register / s".
   2. Japanese is not split at all. Its headings rely on `word-break: keep-all`
      to hold 熟語 together, and per-character boxes defeat that along with
      every other line-breaking rule the language has. Those ripple whole,
      which reads as a sway and costs nothing.

   Screen readers get the original string back through aria-label; the pieces
   are hidden from them. */
function splitLatin(el) {
  if (el.dataset.split) return;
  const text = el.textContent.replace(/\s+/g, ' ').trim();
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  for (const node of nodes) {
    const frag = document.createDocumentFragment();
    for (const word of node.nodeValue.split(/(\s+)/)) {
      if (!word) continue;
      if (/^\s+$/.test(word)) { frag.appendChild(document.createTextNode(' ')); continue; }
      const w = document.createElement('span');
      w.className = 'wd';
      const letters = [...word];
      letters.forEach((ch, i) => {
        const s = document.createElement('span');
        /* Trailing punctuation is styled here rather than wrapped in its own
           <em> in the markup: as a separate element it became its own word
           box and wrapped onto a line by itself. */
        const punct = i >= letters.length - 1 && /[.,;:!?]/.test(ch);
        s.className = punct ? 'ch ch--punct' : 'ch';
        s.textContent = ch;
        w.appendChild(s);
      });
      frag.appendChild(w);
    }
    node.parentNode.replaceChild(frag, node);
  }
  el.setAttribute('aria-label', text);
  for (const s of el.querySelectorAll('.wd')) s.setAttribute('aria-hidden', 'true');
  el.dataset.split = '1';
}

/* Latin display type ripples letter by letter; Japanese headings ripple as a
   single block. */
const charTargets = [...document.querySelectorAll('.hero__line, .h-en')];
const blockTargets = [...document.querySelectorAll('.h-jp')];
if (!reduced) charTargets.forEach(splitLatin);

/* ── Reveal ───────────────────────────────────────────────────────────── */

const revealables = [...document.querySelectorAll('.rv')];
let revealSections = [];
if (reduced) {
  revealables.forEach((el) => el.classList.add('is-in'));
} else {
  const seen = new Map();
  revealables.forEach((el) => {
    const parent = el.parentElement;
    const n = seen.get(parent) || 0;
    seen.set(parent, n + 1);
    /* Shorter and capped sooner. The stagger is there to give a block a sense
       of order, not to make the reader wait for the fifth line. */
    el.style.transitionDelay = `${Math.min(n, 3) * 45}ms`;
  });

  /* Reveals are driven from the scroll loop, not from IntersectionObserver.

     Two things went wrong with the observer. Watching the individual pieces
     meant watching elements inside `overflow: hidden`, and an ancestor's clip
     is applied to the intersection rectangle — a plate that parallax had
     pushed past its section edge never intersected anything and stayed
     invisible for the entire session. Watching the sections instead fixed
     that but introduced a worse one: entries are delivered asynchronously and
     coalesced, so a fast flick skipped most of them outright.

     The loop already knows where every section is, to the pixel, every frame.
     Asking it one more question cannot miss. */
  revealSections = [...document.querySelectorAll('.mv')].map((el) => ({
    el, items: [...el.querySelectorAll('.rv')], done: false, top: 0,
  }));
}

/* ── Nav highlight ────────────────────────────────────────────────────── */

const links = [...document.querySelectorAll('.jump a')];
const targets = links
  .map((a) => ({ a, el: document.querySelector(a.getAttribute('href')) }))
  .filter((t) => t.el);

if (targets.length && 'IntersectionObserver' in window) {
  const nav = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const hit = targets.find((t) => t.el === e.target);
      if (hit && e.isIntersecting) links.forEach((a) => a.classList.toggle('is-on', a === hit.a));
    }
  }, { rootMargin: '-45% 0px -45% 0px' });
  targets.forEach((t) => nav.observe(t.el));
}

/* ── Air ──────────────────────────────────────────────────────────────── */

const airCanvas = document.getElementById('air');
let air = null;
if (!reduced && airCanvas) {
  import('./air.js')
    .then(({ createAir }) => {
      air = createAir(airCanvas);
      if (!air) airCanvas.classList.add('is-dead');
    })
    .catch(() => airCanvas.classList.add('is-dead'));
} else if (airCanvas) {
  airCanvas.classList.add('is-dead');
}

/* ── Measured once, not every frame ───────────────────────────────────── */

const progFill = document.getElementById('prog-fill');
const progNum = document.getElementById('prog');

const movers = [
  ...[...document.querySelectorAll('.mv__bg img')].map((el) => ({ el, depth: 0.10, plate: false })),
  ...[...document.querySelectorAll('.plate')].map((el) => ({
    el, depth: parseFloat(el.dataset.depth || '0.15'), plate: true,
  })),
].map((m) => ({ ...m, box: m.el.closest('.mv'), mid: 0, applied: -1e9 }));

const chars = [];
let vh = window.innerHeight;
let narrow = matchMedia('(max-width: 820px)').matches;
let docMax = 1;

function measure() {
  vh = window.innerHeight;
  narrow = matchMedia('(max-width: 820px)').matches;
  docMax = Math.max(1, document.documentElement.scrollHeight - vh);

  const y = window.scrollY;
  for (const m of movers) {
    const r = m.box.getBoundingClientRect();
    m.mid = r.top + y + r.height / 2;      // document-space centre of the section
    m.applied = -1e9;
  }
  for (const s of revealSections) s.top = s.el.getBoundingClientRect().top + y;

  chars.length = 0;
  if (reduced) return;
  for (const el of charTargets) {
    for (const ch of el.querySelectorAll('.ch')) {
      const r = ch.getBoundingClientRect();
      if (!r.width) continue;
      chars.push({ el: ch, x: r.left + window.scrollX + r.width / 2, y: r.top + y + r.height / 2, dx: 0, dy: 0, k: 1 });
    }
  }
  for (const el of blockTargets) {
    const r = el.getBoundingClientRect();
    if (!r.width) continue;
    /* A whole heading swinging as far as a single letter would look like a
       glitch, so the block movers are damped hard. */
    chars.push({ el, x: r.left + window.scrollX + r.width / 2, y: r.top + y + r.height / 2, dx: 0, dy: 0, k: 0.28 });
  }
}

/* Everything that can move a measured thing after the fact: the webfonts
   (which reflow every glyph), and the lazy plates (which have no intrinsic
   size, so on a phone each one that arrives grows its section). */
let remeasure = 0;
function scheduleMeasure() {
  clearTimeout(remeasure);
  remeasure = setTimeout(measure, 120);
}
if (document.fonts?.ready) document.fonts.ready.then(measure);
window.addEventListener('resize', measure, { passive: true });
window.addEventListener('load', measure);
for (const img of document.images) {
  if (!img.complete) img.addEventListener('load', scheduleMeasure, { once: true, passive: true });
}
measure();

/* Warm the rest of the plates once the page itself is up. They stay
   `loading="lazy"` so they never compete with the first screen, but a lazy
   image still starts downloading only as it nears the viewport — which, at
   scrolling speed, means arriving after you do. The whole set is 1.4MB and
   this runs when the browser is otherwise idle. */
function warmImages() {
  for (const img of document.querySelectorAll('img[loading="lazy"]')) {
    if (img.complete) continue;
    const pre = new Image();
    pre.decoding = 'async';
    pre.src = img.currentSrc || img.src;
  }
}
const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 400));
if (document.readyState === 'complete') idle(warmImages);
else window.addEventListener('load', () => idle(warmImages), { once: true });

/* ── Ripples over the text ────────────────────────────────────────────── */

const MAX = 6;
const ripples = [];
let pointerX = -1e5, pointerY = -1e5, pointerFresh = 0;

function addRipple(x, y) {
  ripples.push({ x: x + window.scrollX, y: y + window.scrollY, t: 0 });
  if (ripples.length > MAX) ripples.shift();
  if (air) air.ripple(x / window.innerWidth, y / vh);
}

if (!reduced) {
  addEventListener('pointerdown', (e) => addRipple(e.clientX, e.clientY), { passive: true });
  addEventListener('pointermove', (e) => {
    pointerX = e.clientX + window.scrollX;
    pointerY = e.clientY + window.scrollY;
    pointerFresh = 1;
  }, { passive: true });
  addEventListener('pointerleave', () => { pointerFresh = 0; }, { passive: true });
}

/* ── Loop ─────────────────────────────────────────────────────────────── */

let last = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  const y = window.scrollY;
  const p = Math.min(1, Math.max(0, y / docMax));
  progFill.style.width = `${p * 100}%`;
  progNum.textContent = String(Math.round(p * 100)).padStart(2, '0');
  if (reduced) return;
  if (air) air.setScroll(p);

  /* Reveal a section once it is within a fifth of a screen of the fold, so it
     has finished arriving before you get there. */
  const trigger = y + vh * 1.22;
  for (const s of revealSections) {
    if (s.done || s.top > trigger) continue;
    s.done = true;
    for (const el of s.items) el.classList.add('is-in');
  }

  /* Parallax — no layout reads, and nothing written for sections that are not
     on screen. */
  const centre = y + vh / 2;
  for (const m of movers) {
    const rel = (m.mid - centre) / vh;
    if (rel < -1.4 || rel > 1.4) continue;
    const depth = narrow && m.plate ? 0.05 : m.depth;
    const shift = rel * depth * vh;
    /* Sub-pixel churn is invisible and still costs a style write. */
    if (Math.abs(shift - m.applied) < 0.4) continue;
    m.applied = shift;
    m.el.style.transform = m.plate
      ? `translate3d(0, ${-shift.toFixed(1)}px, 0)`
      : `translate3d(0, ${shift.toFixed(1)}px, 0) scale(1.12)`;
  }

  /* Ripples */
  for (let i = ripples.length - 1; i >= 0; i--) {
    ripples[i].t += dt;
    if (ripples[i].t > 1.8) ripples.splice(i, 1);
  }

  const hasWave = ripples.length > 0;
  const hasPointer = pointerFresh > 0;
  if (!hasWave && !hasPointer) return;

  const top = y - 80;
  const bottom = y + vh + 80;

  for (const c of chars) {
    if (c.y < top || c.y > bottom) continue;      // off screen: skip entirely
    let dx = 0, dy = 0;

    for (const r of ripples) {
      const ax = c.x - r.x;
      const ay = c.y - r.y;
      const dist = Math.hypot(ax, ay);
      /* An expanding front, same shape as the one in the shader so the words
         and the dust move as one thing. */
      const front = dist - r.t * 430;
      const wave = Math.sin(front * 0.020) * Math.exp(-Math.abs(front) * 0.0055);
      const life = Math.exp(-r.t * 1.9);
      /* Divided by distance so the swell is strongest at the point of contact
         and the far end of a line only sways. */
      const amp = (wave * life * 52) / (dist + 60);
      dx += ax * amp;
      dy += ay * amp;
    }

    if (hasPointer) {
      const ax = c.x - pointerX;
      const ay = c.y - pointerY;
      const d2 = ax * ax + ay * ay;
      if (d2 < 40000) {                            // within 200px
        const f = Math.exp(-Math.sqrt(d2) * 0.014) * 3.4;
        dx += (ax / (Math.sqrt(d2) + 8)) * f;
        dy += (ay / (Math.sqrt(d2) + 8)) * f;
      }
    }

    /* Ease back rather than snapping, so letting go of a wave settles. */
    c.dx += (dx * c.k - c.dx) * 0.35;
    c.dy += (dy * c.k - c.dy) * 0.35;
    if (Math.abs(c.dx) < 0.05 && Math.abs(c.dy) < 0.05) {
      if (c.el.style.transform) c.el.style.transform = '';
      continue;
    }
    c.el.style.transform = `translate3d(${c.dx.toFixed(2)}px, ${c.dy.toFixed(2)}px, 0)`;
  }
}

requestAnimationFrame(frame);

/* ── #perf ────────────────────────────────────────────────────────────── */

/* Frame rate cannot be measured from a headless or backgrounded browser — the
   readings taken while building this showed 16fps with every effect switched
   off — so the only honest number comes from the real machine. */
if (location.hash === '#perf') {
  const hud = document.createElement('p');
  hud.style.cssText = 'position:fixed;z-index:300;left:50%;top:8px;translate:-50% 0;margin:0;'
    + 'padding:6px 12px;background:rgba(10,8,1,.8);color:#d9d7d4;'
    + 'font:400 11px/1 ui-monospace,monospace;letter-spacing:.12em;pointer-events:none';
  document.body.appendChild(hud);
  let n = 0, t0 = performance.now(), worst = 0, prev = t0;
  (function sample() {
    requestAnimationFrame(sample);
    const t = performance.now();
    worst = Math.max(worst, t - prev);
    prev = t;
    n++;
    if (t - t0 >= 500) {
      hud.textContent = `${Math.round((n * 1000) / (t - t0))} FPS · worst ${worst.toFixed(0)}ms`
        + ` · air ${air ? 'on' : 'off'} · ch ${chars.length}`;
      n = 0; t0 = t; worst = 0;
    }
  })();
}
