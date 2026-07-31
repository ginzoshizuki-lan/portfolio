/* ==========================================================================
   quality.js — decide once up front, then keep watching.

   The up-front guess is coarse on purpose; the watchdog is what actually
   protects the experience. If the frame budget slips we shed the expensive
   things in order — bloom first, then resolution — rather than letting the
   whole thing stutter.
   ========================================================================== */

export function detectQuality() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  if (!gl) return { tier: 'none', webgl: false };

  const coarse = matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 8;
  const dpr = window.devicePixelRatio || 1;

  let tier = 'high';
  if (coarse || cores <= 4 || mem <= 4) tier = 'low';
  else if (cores <= 8 || dpr > 2.5) tier = 'mid';

  /* Capped at 1.5 even on the high tier. This scene is fill-rate bound — big
     overlapping additive quads plus a bloom pass — so every extra pixel costs
     twice, and at dpr 2 on a 1080p laptop that meant rendering 8.3 megapixels
     per frame for a look that is soft and foggy anyway. */
  const presets = {
    high: { pixelRatio: Math.min(dpr, 1.5), bloom: true, antialias: true, textureSize: 512 },
    mid: { pixelRatio: Math.min(dpr, 1.25), bloom: true, antialias: true, textureSize: 512 },
    low: { pixelRatio: Math.min(dpr, 1), bloom: false, antialias: false, textureSize: 256 },
  };

  return { tier, webgl: true, ...presets[tier] };
}

/**
 * Frame-time watchdog. Calls `onDowngrade(step)` at most twice.
 * @param {(step: 1|2) => void} onDowngrade
 */
export function createWatchdog(onDowngrade) {
  let acc = 0;
  let frames = 0;
  let step = 0;
  let graceUntil = performance.now() + 2500; // ignore start-up hitches

  return function sample(dt) {
    if (step >= 2 || performance.now() < graceUntil) return;
    acc += dt;
    frames++;
    if (frames < 60) return;

    const fps = 1000 / (acc / frames);
    acc = 0;
    frames = 0;

    if (fps < 42) {
      step++;
      graceUntil = performance.now() + 3000;
      onDowngrade(step);
    }
  };
}
