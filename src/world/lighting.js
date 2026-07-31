/* ==========================================================================
   lighting.js — an overcast, high, raking light.

   The sun sits high and BEHIND the facade, so the face you approach is in
   shadow. That is the whole point: authority reads as mass you cannot see
   into. Everything the visitor can actually see into is lit from a slot.
   ========================================================================== */

import * as THREE from 'three';

const FOG_NEAR_COLOR = 0x14120f;   // interior air
const FOG_LIGHT_COLOR = 0xd8dade;  // the aperture white-out

export function buildLighting(scene, camera, quality) {
  /* ── fog + background ─────────────────────────────────────────────────
     These two must move together. Exponential fog only tints GEOMETRY by
     distance; where the frame is empty you see the background instead. The
     final movement flies out over nothing, so brightening the fog alone
     produced a black screen where the payoff was supposed to be. */
  const fog = new THREE.FogExp2(FOG_NEAR_COLOR, 0.0058);
  scene.fog = fog;
  scene.background = new THREE.Color(FOG_NEAR_COLOR);

  const fogBase = new THREE.Color(FOG_NEAR_COLOR);
  const fogLight = new THREE.Color(FOG_LIGHT_COLOR);

  /* ── rig ──────────────────────────────────────────────────────────── */
  const hemi = new THREE.HemisphereLight(0x8e97a2, 0x0a0908, 0.85);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xf2eee4, 2.1);
  sun.position.set(-52, 120, -46);
  scene.add(sun);

  /* a cold, weak fill so nothing goes fully black — read as bounce */
  const fill = new THREE.DirectionalLight(0x6d7480, 0.45);
  fill.position.set(40, 26, 90);
  scene.add(fill);

  /* local sources at the two places the light is the subject */
  /* Low enough to actually reach the monoliths' upper bodies — at ceiling
     height the inverse-square falloff left the chamber reading as a black box. */
  const oculus = new THREE.PointLight(0xe8ecf1, 1250, 68, 2);
  oculus.position.set(0, 24, 296);
  scene.add(oculus);

  /* Far enough down the slot that the walls the camera passes between stay
     readable; at full strength it flared them into a flat white field. */
  const aperture = new THREE.PointLight(0xf3ede0, 1700, 150, 2);
  aperture.position.set(0, 46, 538);
  scene.add(aperture);

  /* the visitor's own presence — keeps the fissure walls from crushing to
     black without ever looking like a flashlight */
  const carried = new THREE.PointLight(0xbcc2c9, 26, 26, 2);
  camera.add(carried);
  scene.add(camera);

  const lights = [hemi, sun, fill, oculus, aperture, carried];
  if (quality.tier === 'low') {
    oculus.distance = 60;
    aperture.distance = 140;
  }

  return {
    lights,
    /**
     * @param {number} p normalised journey progress 0..1
     */
    update(p) {
      /* the air opens up in the great hall and closes in the chamber */
      const interior = smoothstep(0.20, 0.30, p) * (1 - smoothstep(0.62, 0.72, p));
      fog.density = 0.0058 - interior * 0.0018;

      /* Final movement: the air turns to light. Deliberately stopped short of
         a white-out — the overlay text is light-on-dark, so the frame has to
         keep enough structure and shadow for it to stay readable. */
      const flare = smoothstep(0.87, 1.0, p);
      fog.color.copy(fogBase).lerp(fogLight, flare * 0.42);
      fog.density += flare * 0.0032;
      scene.background.copy(fogBase).lerp(fogLight, flare * 0.42);
      hemi.intensity = 0.85 + flare * 0.7;
      carried.intensity = 26 * (1 - flare);
    },
    dispose() {
      lights.forEach((l) => l.parent?.remove(l));
    },
  };
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
