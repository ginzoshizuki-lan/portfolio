/* ==========================================================================
   main.js — scroll behaviour for the paper build.

   One rAF loop drives everything that moves (dust, background parallax,
   plates, progress). Reveals are left to IntersectionObserver because they
   fire once and do not need a frame budget. Nothing here reads layout inside
   the loop except getBoundingClientRect on a short cached list, which is what
   keeps this cheap enough to skip a quality ladder entirely.
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

/* ── Reveal ───────────────────────────────────────────────────────────── */

const revealables = [...document.querySelectorAll('.rv')];
if (reduced || !('IntersectionObserver' in window)) {
  revealables.forEach((el) => el.classList.add('is-in'));
} else {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('is-in');
      io.unobserve(e.target);
    }
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });

  /* Siblings inside one block should arrive in sequence, not together. */
  const seen = new Map();
  revealables.forEach((el) => {
    const parent = el.parentElement;
    const n = seen.get(parent) || 0;
    seen.set(parent, n + 1);
    el.style.transitionDelay = `${Math.min(n, 6) * 90}ms`;
    io.observe(el);
  });
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
      if (hit && e.isIntersecting) {
        links.forEach((a) => a.classList.toggle('is-on', a === hit.a));
      }
    }
  }, { rootMargin: '-45% 0px -45% 0px' });
  targets.forEach((t) => nav.observe(t.el));
}

/* ── Motion loop ──────────────────────────────────────────────────────── */

const airCanvas = document.getElementById('air');
let air = null;
if (!reduced && airCanvas) {
  /* Deferred, and not awaited: the dust is atmosphere, and the page must not
     wait on a shader to become readable. (No top-level await — the build
     targets es2020.) */
  import('./air.js')
    .then(({ createAir }) => {
      air = createAir(airCanvas);
      if (!air) airCanvas.classList.add('is-dead');
    })
    .catch(() => airCanvas.classList.add('is-dead'));
} else if (airCanvas) {
  airCanvas.classList.add('is-dead');
}

const progFill = document.getElementById('prog-fill');
const progNum = document.getElementById('prog');

/* Cache the movers once. Backgrounds and plates drift at different rates so
   the plate reads as nearer than the wall behind it. */
const movers = [
  ...document.querySelectorAll('.mv__bg img'),
].map((el) => ({ el, depth: 0.10, box: el.closest('.mv') }));

movers.push(
  ...[...document.querySelectorAll('.plate')].map((el) => ({
    el,
    depth: parseFloat(el.dataset.depth || '0.15'),
    box: el.closest('.mv'),
    plate: true,
  })),
);

let vh = window.innerHeight;
let ticking = false;
/* Narrow layouts drop the plates into the flow, where a full-strength shift
   would slide them over the text they belong to. */
let narrow = matchMedia('(max-width: 820px)').matches;

function measure() {
  vh = window.innerHeight;
  narrow = matchMedia('(max-width: 820px)').matches;
}
window.addEventListener('resize', measure, { passive: true });

function frame(now) {
  requestAnimationFrame(frame);
  if (ticking) return;
  ticking = true;

  const y = window.scrollY;
  const max = document.documentElement.scrollHeight - vh;
  const p = max > 0 ? Math.min(1, Math.max(0, y / max)) : 0;
  progFill.style.width = `${p * 100}%`;
  progNum.textContent = String(Math.round(p * 100)).padStart(2, '0');

  if (!reduced) {
    /* The air runs its own loop; it only needs to know where we are. */
    if (air) air.setScroll(p);

    for (const m of movers) {
      const r = m.box.getBoundingClientRect();
      if (r.bottom < -200 || r.top > vh + 200) continue;   // offscreen: skip
      /* -1 above the fold, +1 below it. */
      const rel = (r.top + r.height / 2 - vh / 2) / vh;
      const depth = narrow && m.plate ? 0.05 : m.depth;
      const shift = rel * depth * vh;
      m.el.style.transform = m.plate
        ? `translate3d(0, ${-shift}px, 0)`
        : `translate3d(0, ${shift}px, 0) scale(1.12)`;
    }
  }

  ticking = false;
}

requestAnimationFrame(frame);

/* ── #perf ────────────────────────────────────────────────────────────── */

/* Frame rate cannot be measured from a headless or backgrounded browser — the
   readings taken while building this showed 16fps with every effect switched
   off — so the only honest number comes from the real machine. Add #perf to
   the URL and it shows in the corner. */
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
      hud.textContent = `${Math.round((n * 1000) / (t - t0))} FPS · worst ${worst.toFixed(0)}ms · air ${air ? 'on' : 'off'}`;
      n = 0; t0 = t; worst = 0;
    }
  })();
}
