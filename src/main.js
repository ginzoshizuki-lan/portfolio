/* ==========================================================================
   main.js — boot, loop, teardown.
   ========================================================================== */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { detectQuality, createWatchdog } from './lib/quality.js';
import { buildWorld } from './world/architecture.js';
import { buildLighting } from './world/lighting.js';
import { createJourney } from './world/journey.js';
import { createOverlay, wireNav } from './ui/overlay.js';

const root = document.documentElement;
const quality = detectQuality();
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── Field of view vs. aspect ────────────────────────────────────────────
   Three.js keeps the VERTICAL fov fixed and lets horizontal follow the aspect
   ratio. On a 16:9 desktop 50° vertical gives ~79° horizontal; on a portrait
   phone the same setting collapses to 24°, a telephoto crop that threw the
   pier numerals and the portrait clean off the sides of the frame. On narrow
   screens we open the vertical fov until horizontal coverage returns.

   Declared here, above the start() call below: these ran as `undefined` when
   they sat further down the file, and the fov silently became NaN. */
const BASE_FOV = 50;
const MIN_HORIZONTAL_FOV = 40;
const MAX_FOV = 78;

function fitFov(camera) {
  const minH = THREE.MathUtils.degToRad(MIN_HORIZONTAL_FOV);
  const hAtBase = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(BASE_FOV) / 2) * camera.aspect);
  camera.fov = hAtBase >= minH
    ? BASE_FOV
    : Math.min(MAX_FOV, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(minH / 2) / camera.aspect)));
  camera.updateProjectionMatrix();
}

/* Either of these means the flythrough is not on the table. The content is
   already in the DOM, so falling back is a matter of letting it lay out. */
if (!quality.webgl || reduced) {
  root.classList.add('is-flat');
  document.getElementById('year').textContent = String(new Date().getFullYear());
  wireFlatNav();
} else {
  start();
}

function wireFlatNav() {
  const toggle = document.querySelector('.nav__toggle');
  const menu = document.getElementById('nav-menu');
  toggle?.addEventListener('click', () => {
    const open = menu.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  menu?.addEventListener('click', () => menu.classList.remove('is-open'));
}

function start() {
  /* ── stage ────────────────────────────────────────────────────────── */
  const canvas = document.getElementById('gl');
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: quality.antialias,
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setPixelRatio(quality.pixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;

  const scene = new THREE.Scene();
  /* 50° vertical, not 58°. Three.js widens horizontally with the aspect ratio,
     so on a 16:9 desktop 58° opened to ~83° horizontal and pushed the masses
     far enough away that the frame read as empty. */
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.4, 1400);
  fitFov(camera);

  const world = buildWorld(scene, quality);
  const lighting = buildLighting(scene, camera, quality);
  const journey = createJourney();
  const overlay = createOverlay(journey);

  /* ── post ─────────────────────────────────────────────────────────── */
  let composer = null;
  let bloom = null;
  if (quality.bloom) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    /* threshold high enough that only the additive light quads bloom —
       concrete highlights must stay crisp or the whole thing turns to soup */
    /* Half-resolution bloom. UnrealBloomPass builds a five-level mip chain and
       at full device resolution that was the single most expensive thing in
       the frame; halving it is invisible on a soft glow and roughly quarters
       the cost. */
    bloom = new UnrealBloomPass(
      new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.62, 0.72, 0.82,
    );
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    composer.setPixelRatio(quality.pixelRatio);
    composer.setSize(innerWidth, innerHeight);
  }

  /* ── scroll ───────────────────────────────────────────────────────── */
  const spacer = document.getElementById('spacer');
  spacer.style.height = `${journey.scrollHeights * 100}vh`;

  const scrollLength = () => Math.max(1, document.body.scrollHeight - innerHeight);

  let target = 0;   // where the scrollbar says we are, 0..1
  let eased = 0;    // where the camera actually is — always chasing
  function readScroll() {
    target = Math.min(1, Math.max(0, window.scrollY / scrollLength()));
  }
  readScroll();
  eased = target;
  addEventListener('scroll', readScroll, { passive: true });

  wireNav(journey, scrollLength);

  /* ── pointer parallax ─────────────────────────────────────────────── */
  const drift = { x: 0, y: 0 };
  const driftTarget = { x: 0, y: 0 };
  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    driftTarget.x = (e.clientX / innerWidth) * 2 - 1;
    driftTarget.y = (e.clientY / innerHeight) * 2 - 1;
  }, { passive: true });

  /* ── keyboard ─────────────────────────────────────────────────────── */
  addEventListener('keydown', (e) => {
    const page = innerHeight * 0.9;
    const map = {
      ArrowDown: page * 0.5, ArrowUp: -page * 0.5,
      PageDown: page, PageUp: -page,
      Home: -1e9, End: 1e9,
    };
    if (!(e.key in map)) return;
    if (e.target !== document.body && e.target !== root) return;
    e.preventDefault();
    scrollBy({ top: map[e.key], behavior: 'smooth' });
  });

  /* ── resize ───────────────────────────────────────────────────────── */
  let resizeTimer = 0;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      camera.aspect = innerWidth / innerHeight;
      fitFov(camera);
      renderer.setSize(innerWidth, innerHeight);
      composer?.setSize(innerWidth, innerHeight);
      spacer.style.height = `${journey.scrollHeights * 100}vh`;
      readScroll();
    }, 140);
  });

  /* ── degradation ──────────────────────────────────────────────────── */
  const watchdog = createWatchdog((step) => {
    if (step === 1 && composer) {
      composer.removePass(bloom);
      bloom.dispose();
      bloom = null;
      composer = null;      // straight to the renderer from here
    } else {
      renderer.setPixelRatio(Math.max(1, renderer.getPixelRatio() * 0.75));
    }
  });

  /* ── pause when off-screen ────────────────────────────────────────── */
  let visible = !document.hidden;
  document.addEventListener('visibilitychange', () => {
    visible = !document.hidden;
    if (visible) last = performance.now();
  });

  /* ── on-device readout ───────────────────────────────────────────────
     Appended only with #debug. Frame rate on real phone hardware cannot be
     measured from here, so this is how it gets checked: open the page with
     #debug on the device and read the number. */
  let hudDebug = null;
  if (location.hash.includes('debug')) {
    hudDebug = document.createElement('div');
    hudDebug.style.cssText =
      'position:fixed;top:56px;left:50%;transform:translateX(-50%);z-index:999;'
      + 'font:11px/1.5 monospace;letter-spacing:.06em;color:#e2e6ea;'
      + 'background:rgba(5,4,3,.82);padding:6px 12px;border:1px solid rgba(200,204,209,.28);'
      + 'pointer-events:none;white-space:nowrap;text-align:center';
    document.body.appendChild(hudDebug);
  }
  let fpsAcc = 0;
  let fpsFrames = 0;

  /* ── loop ─────────────────────────────────────────────────────────── */
  let last = performance.now();
  let settled = false;

  function frame(now) {
    requestAnimationFrame(frame);
    if (!visible) return;

    const dt = Math.min(64, now - last);
    last = now;
    watchdog(dt);

    /* Critically damped chase. The lag IS the flying feeling: the scrollbar
       is where you asked to be, the camera is where it has got to. */
    const k = 1 - Math.pow(0.00035, dt / 1000);
    eased += (target - eased) * k;
    if (Math.abs(target - eased) < 0.00002) eased = target;

    drift.x += (driftTarget.x - drift.x) * (1 - Math.pow(0.02, dt / 1000));
    drift.y += (driftTarget.y - drift.y) * (1 - Math.pow(0.02, dt / 1000));

    const wp = journey.apply(camera, eased, now, drift);
    lighting.update(eased);
    overlay.update(wp, eased);

    if (composer) composer.render(dt / 1000);
    else renderer.render(scene, camera);

    if (hudDebug) {
      fpsAcc += dt;
      if (++fpsFrames >= 30) {
        const fps = Math.round(1000 / (fpsAcc / fpsFrames));
        hudDebug.textContent =
          `${fps} fps · ${quality.tier} · dpr ${renderer.getPixelRatio().toFixed(2)}`
          + ` · fov ${camera.fov.toFixed(0)}° · ${innerWidth}×${innerHeight}`
          + ` · ${(eased * 100).toFixed(0)}%`;
        fpsAcc = 0;
        fpsFrames = 0;
      }
    }

    if (!settled) {
      settled = true;
      root.classList.add('is-ready');
    }
  }
  requestAnimationFrame(frame);

  /* ── expose for debugging from the console ────────────────────────────
     Also available in a production build via #debug, which is the only way
     to inspect camera framing on a static host. */
  /* Hash test first: with `import.meta.env?.DEV` leading, the minifier folded
     the whole condition to a constant and dropped the block from the build. */
  if (location.hash.includes('debug') || import.meta.env?.DEV) {
    /* deliberately NOT exposing the THREE namespace — referencing it here
       pins every export and costs ~190 kB of dropped tree-shaking */
    Object.assign(window, { scene, camera, renderer, journey, world, lighting });
    console.info(
      `[monument] tier=${quality.tier} dpr=${quality.pixelRatio} bloom=${quality.bloom}\n` +
      'window.journey.scrollAt(n) → scroll fraction for waypoint n; ' +
      'scrollTo({top: journey.scrollAt(11) * (document.body.scrollHeight - innerHeight)})',
    );
  }
}
