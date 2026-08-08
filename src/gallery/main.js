/* ==========================================================================
   main.js — wiring. Reads the lenses out of the document, starts the gallery,
   and keeps the chrome in sync with it.

   The document is authoritative. If WebGL is missing, or the visitor asked for
   reduced motion, we never add .is-gl and the page stays what it already is:
   a readable article list. Same decision the flythrough build made.
   ========================================================================== */

import { FORMATION_IDS } from './formations.js';

const root = document.documentElement;
const boot = document.getElementById('boot');
const bootFill = document.getElementById('boot-fill');
const bootPct = document.getElementById('boot-pct');

/* ── Read the lenses ──────────────────────────────────────────────────── */

const nodes = [...document.querySelectorAll('.lens')];
const lenses = nodes.map((el) => ({
  num: el.dataset.num || '',
  cat: el.dataset.cat || '',
  title: el.dataset.title || el.querySelector('h2')?.textContent || '',
  tags: el.dataset.tags || '',
  link: el.dataset.link || '',
  linkLabel: el.dataset.linkLabel || '',
  html: [...el.querySelectorAll('p')].map((p) => `<p>${p.innerHTML}</p>`).join(''),
}));

document.getElementById('year').textContent = new Date().getFullYear();

/* ── Clock ────────────────────────────────────────────────────────────── */

const clockEl = document.getElementById('clock');
function paintClock() {
  const t = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());
  clockEl.textContent = `JST ${t}`;
}
paintClock();
setInterval(paintClock, 15000);

/* ── Capability gate ──────────────────────────────────────────────────── */

const fine = matchMedia('(pointer: fine)').matches;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const hasWebGL = (() => {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
})();

if (fine) root.classList.add('is-fine');

/* Escape hatch: the skip link drops out of the canvas entirely rather than
   focusing a clipped region nobody can see. */
document.querySelector('.skip-link')?.addEventListener('click', () => {
  root.classList.remove('is-gl');
  boot?.classList.add('is-done');
});

if (!hasWebGL || reduced) {
  boot?.classList.add('is-done');
} else {
  root.classList.add('is-gl');
  start();
}

/* ── Boot ─────────────────────────────────────────────────────────────── */

async function start() {
  let pct = 0;
  const setPct = (v) => {
    pct = Math.max(pct, Math.min(100, Math.round(v)));
    bootFill.style.width = `${pct}%`;
    bootPct.textContent = String(pct).padStart(3, '0');
  };
  setPct(6);

  /* Plates are drawn with Zen Old Mincho and JetBrains Mono. Drawing before
     they resolve bakes the fallback face into the texture permanently — a
     canvas texture is not re-rendered when a font arrives later. */
  const fontsReady = document.fonts?.ready ?? Promise.resolve();
  const ramp = setInterval(() => setPct(pct + 4), 90);
  await fontsReady;
  clearInterval(ramp);
  setPct(62);

  const { createScene } = await import('./scene.js');
  setPct(78);

  const scene = createScene(document.getElementById('gl'), lenses, {
    formation: 'ring',
    fine,
  });

  if (!scene) {                       // context creation failed after the probe
    root.classList.remove('is-gl');
    boot.classList.add('is-done');
    return;
  }

  setPct(100);
  setTimeout(() => boot.classList.add('is-done'), 320);

  wire(scene);
}

/* ── Chrome ───────────────────────────────────────────────────────────── */

function wire(scene) {
  const wordmark = document.getElementById('wordmark');
  const hint = document.getElementById('hint');
  const cursor = document.getElementById('cursor');
  const sw = document.getElementById('switch');

  /* Formation switcher */
  sw.addEventListener('click', (e) => {
    const btn = e.target.closest('.switch__item');
    if (!btn) return;
    const id = btn.dataset.form;
    if (!FORMATION_IDS.includes(id)) return;
    sw.querySelectorAll('.switch__item').forEach((b) => b.classList.toggle('is-on', b === btn));
    scene.setFormation(id);
    /* The wordmark is the resting state. Once the visitor has rearranged the
       space it is their view, not a title card — and over the grid it sat on
       top of two plates and made both harder to read. */
    wordmark.classList.add('is-gone');
    hint.classList.add('is-hidden');
  });

  /* Colour mode */
  const modeBtn = document.getElementById('mode');
  modeBtn.addEventListener('click', () => {
    const next = document.body.dataset.mode === 'paper' ? 'void' : 'paper';
    document.body.dataset.mode = next;
    /* Let the CSS transition land before sampling the new values, or the
       plates get redrawn with the colours we are transitioning away from. */
    requestAnimationFrame(() => requestAnimationFrame(() => scene.refreshPalette()));
  });

  /* Custom cursor */
  if (cursor && matchMedia('(pointer: fine)').matches) {
    addEventListener('pointermove', (e) => {
      cursor.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
    }, { passive: true });
    addEventListener('pointerdown', () => cursor.classList.add('is-down'));
    addEventListener('pointerup', () => cursor.classList.remove('is-down'));
  }

  scene.on('hover', (lens) => {
    cursor?.classList.toggle('is-hot', !!lens);
    /* Reading a plate and reading the wordmark are different jobs; get the
       wordmark out of the way as soon as a card is the subject. */
    wordmark.classList.toggle('is-hidden', !!lens);
  });

  let dragged = false;
  scene.on('drag', (down) => {
    wordmark.classList.toggle('is-hidden', down);
    if (down && !dragged) { dragged = true; hint.classList.add('is-hidden'); }
  });

  /* Detail sheet */
  const sheet = document.getElementById('sheet');
  const fields = {
    num: document.getElementById('sheet-num'),
    cat: document.getElementById('sheet-cat'),
    title: document.getElementById('sheet-title'),
    text: document.getElementById('sheet-text'),
    tags: document.getElementById('sheet-tags'),
    link: document.getElementById('sheet-link'),
  };
  let lastFocus = null;

  function open(lens, index) {
    fields.num.textContent = lens.num;
    fields.cat.textContent = lens.cat;
    fields.title.textContent = lens.title;
    fields.text.innerHTML = lens.html;
    fields.tags.textContent = lens.tags;
    if (lens.link) {
      fields.link.href = lens.link;
      fields.link.textContent = `${lens.linkLabel || lens.link} ↗`;
      fields.link.hidden = false;
    } else {
      fields.link.hidden = true;
    }
    lastFocus = document.activeElement;
    sheet.hidden = false;
    scene.focus(index);
    sheet.querySelector('.sheet__close').focus();
  }

  function close() {
    sheet.hidden = true;
    lastFocus?.focus?.();
  }

  scene.on('pick', open);
  sheet.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) close(); });

  if (location.hash === '#debug') {
    /* Same convention as the flythrough build's window.journey: a handle to
       poke at from the console when a layout looks wrong. */
    window.lensSpace = scene;
    const tag = document.createElement('p');
    tag.style.cssText = 'position:fixed;top:50%;left:8px;z-index:200;font:11px monospace;color:var(--ink)';
    tag.textContent = `tier ${scene.tier}`;
    document.body.appendChild(tag);
  }
}
