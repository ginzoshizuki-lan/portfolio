/* ==========================================================================
   architecture.js — the monument.

   One continuous mass, read in seven movements as the camera travels +Z:

     z  -110 …   -8   plaza          the approach
     z    -8 …   78   fissure        a 7 m slot cut through 60 m of concrete
     z    78 …  252   colonnade      great hall, four piers, slalom
     z   252 …  334   chamber        closed room, oculus, three monoliths
     z   334 …  402   ascent         a ziggurat stair, portrait in a recess
     z   402 …  464   archive        high gallery, a wall of light slots
     z   464 …  540   aperture       the mass parts, the fog turns to light

   Slabs are collected per movement and merged, so the whole building is a
   handful of draw calls.
   ========================================================================== */

import * as THREE from 'three';
import { slab, pier, buildMass } from '../lib/geometry.js';
import { createConcrete, createInscription, makeRandom } from '../lib/textures.js';
import { lightShaft, lightPool, lightSlot, decal, contactShadow } from '../lib/glow.js';

/* ── dimensions worth naming ─────────────────────────────────────────── */
const FISSURE_HALF = 3.6;   // half-width of the slot you walk through
const HALL_HALF = 34;       // colonnade inner half-width
const HALL_CEIL = 44;
const CHAMBER_HALF = 30;
const CHAMBER_CEIL = 38;
const OCULUS = 12;
const OCULUS_Z = 296;
const STAIR_RISE = 2.2;
const STAIR_RUN = 4.6;
const STAIR_STEPS = 14;
const STAIR_Z0 = 336;
const DECK_Y = STAIR_STEPS * STAIR_RISE;   // 30.8 — archive floor level

export const LANDMARKS = {
  fissureZ: 0,
  hallZ: 78,
  oculus: new THREE.Vector3(0, 0, OCULUS_Z),
  deckY: DECK_Y,
  apertureZ: 500,
};

export function buildWorld(scene, quality) {
  const rnd = makeRandom(0xc0ffee);
  const group = new THREE.Group();
  group.name = 'monument';
  scene.add(group);

  const concrete = createConcrete(quality.textureSize, 7);
  const stone = new THREE.MeshStandardMaterial({
    map: concrete.map,
    roughnessMap: concrete.roughnessMap,
    bumpMap: concrete.bumpMap,
    bumpScale: 0.35,
    color: 0x8f8d88,
    roughness: 1.0,
    metalness: 0.0,
    dithering: true,
  });

  /* The floor gets its own texture with the board-form seams suppressed. */
  const poured = createConcrete(quality.textureSize, 23, { seams: false });
  const floorStone = new THREE.MeshStandardMaterial({
    map: poured.map,
    roughnessMap: poured.roughnessMap,
    bumpMap: poured.bumpMap,
    bumpScale: 0.16,
    /* Much darker than the walls. An up-facing plane takes the full hemisphere
       light, so at wall tone the floor turns into the brightest thing in frame
       — the exact inverse of a near-black palette. */
    color: 0x4e4c49,
    roughness: 1.0,
    metalness: 0.0,
    dithering: true,
  });

  const glow = new THREE.Group();
  glow.name = 'glow';
  group.add(glow);

  /* ── ground ─────────────────────────────────────────────────────────
     Stops before the aperture so the final flight is over nothing. */
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(560, 620, 1, 1), floorStone);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, 155);
  {
    /* the plane's UVs span 0..1 over 560 m — retile to match the slabs */
    const uv = ground.geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 80, uv.getY(i) * 88);
    uv.needsUpdate = true;
  }
  group.add(ground);

  /* =====================================================================
     I. PLAZA + II. FISSURE  (z -110 … 78)
     A single mass split down the middle. Stepped blocks of varying height
     and depth give the canyon walls relief; three lintels bridge the slot
     overhead so the sky above you is interrupted, not continuous.
     ===================================================================== */
  {
    const parts = [];

    for (const side of [-1, 1]) {
      let z = -10;
      while (z < 80) {
        const dz = 8 + rnd() * 11;
        const h = 44 + rnd() * 32;
        const w = 26 + rnd() * 50;
        const inner = FISSURE_HALF + rnd() * 1.1;         // jitter = relief
        parts.push(pier([w, h, dz], [side * (inner + w / 2), 0, z + dz / 2]));
        z += dz;
      }
      /* Buttress fins flanking the plaza. They sit well out to the sides:
         close in they became a second canyon and swallowed the approach,
         which is the one shot that has to feel open. */
      for (let i = 0; i < 5; i++) {
        const fz = -34 - i * 16 - rnd() * 6;
        parts.push(pier([6 + rnd() * 5, 12 + rnd() * 20, 12 + rnd() * 8],
          [side * (23 + rnd() * 15), 0, fz]));
      }
    }

    /* lintels across the slot */
    for (const [lz, y0, y1] of [[26, 50, 58], [52, 44, 51], [70, 56, 63]]) {
      parts.push(slab([FISSURE_HALF * 2 + 2, y1 - y0, 7], [0, (y0 + y1) / 2, lz]));
    }

    /* Low monoliths scattered across the plaza. Deliberately small: they are
       the only thing in frame that tells you how big the facade is. */
    for (let i = 0; i < 18; i++) {
      const px = (rnd() < 0.5 ? -1 : 1) * (11 + rnd() * 68);
      const pz = -106 + rnd() * 92;
      parts.push(pier([2.5 + rnd() * 5, 2 + rnd() * 7, 2.5 + rnd() * 5], [px, 0, pz],
        rnd() * Math.PI));
    }

    group.add(buildMass(parts, stone, 'mass-fissure'));

    /* the slot, seen from the plaza: a 54 m blade of light */
    glow.add(lightSlot({ width: FISSURE_HALF * 2, height: 54, at: [0, 27, 1.5], opacity: 0.42 }));

    /* Light falling into the slot, broken by the lintels. Kept faint: seen
       end-on from the plaza these stack up behind the blade, and at full
       strength they read as rungs on a ladder rather than as depth. */
    for (const sz of [8, 20, 38, 48, 64, 76]) {
      glow.add(lightShaft({ width: FISSURE_HALF * 2, height: 46, at: [0, 46, sz], opacity: 0.1 }));
      glow.add(lightPool({ size: 9, aspect: 0.85, at: [0, 0.06, sz], opacity: 0.3 }));
    }
  }

  /* =====================================================================
     III. COLONNADE  (z 78 … 252)
     Four piers, alternating left and right, that the camera slaloms past.
     The ceiling is slotted, so bands of light cross the floor between them.
     ===================================================================== */
  /* Pushed deeper into the hall than the first layout. At z=100 the camera
     entered the hall (z=78) only 22 m short of pier 01 and was already level
     with it by the time its card appeared — you read "02" down the hall while
     the card said "01". Starting at 120 gives every pier ~35-45 m of approach. */
  const PIERS = [
    { z: 120, x: -20 },
    { z: 160, x: 20 },
    { z: 200, x: -20 },
    { z: 240, x: 20 },
  ];
  const CEIL_GAPS = [96, 118, 140, 162, 184, 206, 228, 248];

  {
    const parts = [];

    /* side walls, stepped */
    for (const side of [-1, 1]) {
      let z = 78;
      while (z < 254) {
        const dz = 11 + rnd() * 13;
        const h = HALL_CEIL + 8 + rnd() * 22;
        const w = 22 + rnd() * 26;
        const inner = HALL_HALF + rnd() * 1.4;
        parts.push(pier([w, h, dz], [side * (inner + w / 2), 0, z + dz / 2]));
        z += dz;
      }
    }

    /* ceiling, in segments between the light slots */
    let cz = 78;
    for (const gap of [...CEIL_GAPS, 254]) {
      const depth = gap - 2 - cz;
      if (depth > 0.5) {
        parts.push(slab([HALL_HALF * 2, 6, depth], [0, HALL_CEIL + 3, cz + depth / 2]));
      }
      cz = gap + 2;
    }

    /* the four piers, each with a shallow plinth and a capital */
    for (const p of PIERS) {
      parts.push(pier([13, 40, 13], [p.x, 0, p.z]));
      parts.push(pier([16, 1.2, 16], [p.x, 0, p.z]));
      parts.push(slab([15.4, 2.4, 15.4], [p.x, 41.2, p.z]));
      glow.add(contactShadow({ size: 30, at: [p.x, 0.04, p.z], opacity: 0.5 }));
    }

    group.add(buildMass(parts, stone, 'mass-colonnade'));

    /* light bands from the ceiling slots */
    for (const gz of CEIL_GAPS) {
      glow.add(lightSlot({
        width: HALL_HALF * 2, height: 4,
        at: [0, HALL_CEIL - 0.2, gz], rotX: -Math.PI / 2, opacity: 0.42,
      }));
      glow.add(lightShaft({
        width: HALL_HALF * 2, height: HALL_CEIL,
        at: [0, HALL_CEIL - 0.4, gz], opacity: 0.2, crossed: false,
      }));
      glow.add(lightPool({ size: 9, aspect: 7.2, at: [0, 0.06, gz], opacity: 0.4 }));
    }

    /* Numerals on the face that meets the oncoming camera, not the inner
       face. Side-on they were only legible in the moment you were already
       past them; head-on they read from the far end of the hall. */
    PIERS.forEach((p, i) => {
      const tex = createInscription(String(i + 1).padStart(2, '0'), {
        width: 256, height: 256, font: '500 176px "JetBrains Mono", monospace', tracking: 0.02,
      });
      glow.add(decal(tex, {
        width: 7.5, height: 7.5,
        at: [p.x, 9, p.z - 6.65],
        rotY: Math.PI,
        opacity: 0.55,
      }));
      /* a wash so the approaching face isn't a black slab */
      glow.add(lightPool({
        size: 28, aspect: 0.62,
        at: [p.x, 17, p.z - 6.6],
        rotX: 0, opacity: 0.14,
      }));
    });
  }

  /* =====================================================================
     IV. CHAMBER  (z 252 … 334)
     Closed on all six sides but for two portals and a square oculus.
     Three monoliths stand around the shaft; the camera orbits it.
     ===================================================================== */
  /* Clustered near the shaft so the orbiting camera reads each as a backlit
     subject rather than as an obstacle. See the chamber notes in journey.js. */
  const MONOLITHS = [
    { x: -6, z: 292 },
    { x: 6, z: 297 },
    { x: 0, z: 304 },
  ];

  {
    const parts = [];
    /* A 14 m doorway, not 10: the camera has to pass through it dead centre
       and any overshoot in the spline used to put it inside the wall. */
    const PORTAL_HALF = 7;
    const PORTAL_H = 16;

    /* front (z 252-262) and back (z 326-336) walls, each pierced by a portal */
    for (const [z0, z1] of [[252, 262], [326, 336]]) {
      const d = z1 - z0, cz = (z0 + z1) / 2;
      const wing = CHAMBER_HALF - PORTAL_HALF;
      parts.push(pier([wing, CHAMBER_CEIL + 6, d], [-(PORTAL_HALF + wing / 2), 0, cz]));
      parts.push(pier([wing, CHAMBER_CEIL + 6, d], [PORTAL_HALF + wing / 2, 0, cz]));
      parts.push(slab([PORTAL_HALF * 2, CHAMBER_CEIL + 6 - PORTAL_H,
        d], [0, (CHAMBER_CEIL + 6 + PORTAL_H) / 2, cz]));
    }

    /* side walls */
    for (const side of [-1, 1]) {
      parts.push(pier([16, CHAMBER_CEIL + 10, 74], [side * (CHAMBER_HALF + 8), 0, 299]));
    }

    /* ceiling in four blocks around the oculus */
    const oHalf = OCULUS / 2;
    const zA = 262, zB = 326;
    parts.push(slab([CHAMBER_HALF * 2, 5, (OCULUS_Z - oHalf) - zA],
      [0, CHAMBER_CEIL + 2.5, (zA + OCULUS_Z - oHalf) / 2]));
    parts.push(slab([CHAMBER_HALF * 2, 5, zB - (OCULUS_Z + oHalf)],
      [0, CHAMBER_CEIL + 2.5, (zB + OCULUS_Z + oHalf) / 2]));
    for (const side of [-1, 1]) {
      parts.push(slab([CHAMBER_HALF - oHalf, 5, OCULUS],
        [side * (oHalf + (CHAMBER_HALF - oHalf) / 2), CHAMBER_CEIL + 2.5, OCULUS_Z]));
    }

    /* The three monoliths. 13 m, not 20: at the ~20 m viewing distance the
       orbit allows, a 20 m slab subtends more than the whole frame and stops
       being an object in a room. */
    for (const m of MONOLITHS) {
      parts.push(pier([5, 13, 5], [m.x, 0, m.z]));
      glow.add(contactShadow({ size: 12, at: [m.x, 0.04, m.z], opacity: 0.62 }));
    }

    group.add(buildMass(parts, stone, 'mass-chamber'));

    /* the shaft */
    glow.add(lightSlot({
      width: OCULUS, height: OCULUS,
      at: [0, CHAMBER_CEIL - 0.2, OCULUS_Z], rotX: -Math.PI / 2, opacity: 0.7,
    }));
    glow.add(lightShaft({
      width: OCULUS * 0.94, height: CHAMBER_CEIL,
      at: [0, CHAMBER_CEIL - 0.3, OCULUS_Z], opacity: 0.58,
    }));
    glow.add(lightPool({ size: 25, at: [0, 0.07, OCULUS_Z], opacity: 0.88 }));

    /* an inscription on the far wall, read on the way out */
    glow.add(decal(createInscription('言 説 空 間', {
      width: 1024, height: 256,
      font: '500 132px "Zen Old Mincho", serif', tracking: 0.12,
    }), { width: 26, height: 6.5, at: [0, 11, 325.4], rotY: Math.PI, opacity: 0.4 }));
  }

  /* =====================================================================
     V. ASCENT  (z 336 … 402)
     A ziggurat stair. Open to the sky, flanked by walls; the left wall has
     a deep recess at mid-height holding the portrait.
     ===================================================================== */
  {
    const parts = [];

    for (let i = 0; i < STAIR_STEPS; i++) {
      const h = (i + 1) * STAIR_RISE;
      parts.push(slab([30, h, STAIR_RUN], [0, h / 2, STAIR_Z0 + i * STAIR_RUN + STAIR_RUN / 2]));
    }

    /* Both flanking walls are plain. The portrait used to hang in a lit niche
       cut into the left wall; it now lives in the HTML overlay instead, so the
       niche has no subject and the wall is simply solid. */
    parts.push(pier([19, 62, 70], [24.5, 0, 369]));
    parts.push(pier([19, 62, 70], [-24.5, 0, 369]));

    group.add(buildMass(parts, stone, 'mass-ascent'));

    /* sky washing down the stair */
    for (const sz of [344, 358, 372, 386, 398]) {
      glow.add(lightShaft({ width: 26, height: 56, at: [0, 62, sz], opacity: 0.22, crossed: false }));
    }
    for (let i = 1; i < STAIR_STEPS; i += 2) {
      glow.add(lightPool({
        size: 7, aspect: 3.6,
        at: [0, i * STAIR_RISE + 0.07, STAIR_Z0 + i * STAIR_RUN + STAIR_RUN / 2],
        opacity: 0.22,
      }));
    }

  }

  /* =====================================================================
     VI. ARCHIVE  (z 402 … 466)
     A high deck. To the right, a wall of narrow light slots; to the left,
     a low parapet and a 30 m drop.
     ===================================================================== */
  {
    const parts = [];

    parts.push(slab([40, 4, 66], [0, DECK_Y - 2, 433]));            // deck
    parts.push(pier([16, 58, 66], [28, 0, 433]));                    // slotted wall
    parts.push(slab([2, 1.6, 66], [-19, DECK_Y + 0.8, 433]));        // parapet
    parts.push(slab([44, 5, 66], [0, DECK_Y + 24, 433]));            // soffit above

    group.add(buildMass(parts, stone, 'mass-archive'));

    const SLOTS = quality.tier === 'low' ? 16 : 30;
    for (let k = 0; k < SLOTS; k++) {
      const z = 404 + k * (60 / SLOTS);
      glow.add(lightSlot({
        width: 0.55, height: 13,
        at: [19.9, DECK_Y + 9, z], rotY: Math.PI / 2, opacity: 0.62,
      }));
      if (k % 3 === 0) {
        glow.add(lightPool({
          size: 12, aspect: 0.5,
          at: [19.5, DECK_Y + 9, z], rotX: 0, rotY: Math.PI / 2, opacity: 0.16,
        }));
      }
    }
  }

  /* =====================================================================
     VII. APERTURE  (z 466 … 540)
     The mass parts. Two 90 m slabs, a 16 m gap, and light instead of a room
     on the other side.
     ===================================================================== */
  {
    const parts = [];
    for (const side of [-1, 1]) {
      /* 74 m deep, so the camera is still between them at the last waypoint */
      parts.push(pier([54, 92, 74], [side * (8 + 27), 0, 503]));
      parts.push(pier([20, 66, 14], [side * 18, 0, 462]));
    }
    group.add(buildMass(parts, stone, 'mass-aperture'));

    /* The destination stays bright; everything the camera passes *through* is
       kept faint, or the additive quads fill the frame and the 92 m walls
       either side stop reading as walls at all. */
    glow.add(lightSlot({ width: 16, height: 92, at: [0, 46, 540.5], opacity: 0.62 }));
    glow.add(lightShaft({ width: 17, height: 74, at: [0, 92, 528], opacity: 0.16, crossed: false }));
    glow.add(lightShaft({ width: 17, height: 74, at: [0, 92, 502], opacity: 0.1, crossed: false }));
    glow.add(lightPool({ size: 44, aspect: 0.42, at: [0, 44, 540], rotX: 0, opacity: 0.28 }));
  }

  return {
    group,
    glow,
    piers: PIERS,
    monoliths: MONOLITHS,
    dispose() {
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => { Object.values(m).forEach((v) => v?.isTexture && v.dispose()); m.dispose(); });
        }
      });
      scene.remove(group);
    },
  };
}
