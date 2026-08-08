/* ==========================================================================
   formations.js — where every plate wants to be, per formation.

   Two rules make this survive a phone held upright:

   1. Every formation ships a portrait variant that redistributes the same
      cards along Y instead of X. A ring and a grid are both wide shapes; on a
      390px-wide screen the camera would have to retreat so far to frame them
      that the text stops being readable. Trading width for height keeps the
      cards large.

   2. Nothing here hard-codes a camera distance. Each layout reports the
      bounding radius it actually occupies and the scene frames that, so a
      layout change can never push content off-screen.
   ========================================================================== */

export const CARD_W = 1;
export const CARD_H = 4 / 3;

/* Deterministic hash so "drift" is scattered but identical on every load —
   Math.random() here would make the layout unrepeatable between reloads and
   impossible to reason about. */
function h(i, salt) {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const ring = (i, n, p) => {
  const t = (i / n) * Math.PI * 2;

  /* Upright, the ring turns on its side: a wheel in the YZ plane, one card
     wide and many cards tall. A horizontal ring is 4.3 units across, and
     fitting that into a 390px viewport pushed the camera so far back that a
     card came out 12% of the screen height — unreadable. Turned vertical it
     costs no width at all, so the camera can sit close and the front card
     fills most of the screen. */
  if (p) {
    const R = 1.5;
    return {
      x: Math.sin(t * 2) * 0.1,
      y: Math.sin(t) * R,
      z: Math.cos(t) * R,
      rx: -t,                       // rotX(-t) points the plate normal along (0, sin t, cos t)
      ry: 0,
      rz: 0,
    };
  }

  const R = 2.15;
  return {
    x: Math.sin(t) * R,
    y: Math.sin(t * 2) * 0.34,
    z: Math.cos(t) * R,
    ry: t,
    rx: 0,
    rz: Math.sin(t * 2) * 0.05,
  };
};

const helix = (i, n, p) => {
  /* Upright the radius is what costs width, so it shrinks hard; the height is
     free. */
  const R = p ? 0.72 : 1.55;
  const turns = p ? 1.0 : 1.25;
  const t = (i / n) * Math.PI * 2 * turns;
  const height = p ? 4.2 : 3.4;
  const u = n === 1 ? 0.5 : i / (n - 1);
  return {
    x: Math.sin(t) * R,
    y: (u - 0.5) * height,
    z: Math.cos(t) * R,
    ry: t,
    rx: -0.06,
    rz: 0,
  };
};

const grid = (i, n, p) => {
  const cols = p ? 2 : Math.min(5, Math.ceil(Math.sqrt(n * 1.45)));
  const rows = Math.ceil(n / cols);
  const gx = CARD_W * 1.26;
  const gy = CARD_H * (p ? 1.1 : 1.2);
  const col = i % cols;
  const row = Math.floor(i / cols);
  return {
    x: (col - (cols - 1) / 2) * gx,
    y: -(row - (rows - 1) / 2) * gy,
    /* A whisper of depth so the grid still reads as 3D when it spins. */
    z: Math.sin(col * 1.7 + row * 2.3) * 0.22,
    ry: 0,
    rx: 0,
    rz: 0,
  };
};

const drift = (i, n, p) => {
  const bx = p ? 1.35 : 4.4;
  const by = p ? 4.2 : 2.7;
  const bz = p ? 2.6 : 3.4;
  return {
    x: (h(i, 1) - 0.5) * 2 * bx,
    y: (h(i, 2) - 0.5) * 2 * by,
    z: (h(i, 3) - 0.5) * 2 * bz,
    ry: (h(i, 4) - 0.5) * 0.9,
    rx: (h(i, 5) - 0.5) * 0.5,
    rz: (h(i, 6) - 0.5) * 0.3,
  };
};

export const FORMATIONS = {
  /* facing:
       radial — the plate's normal points away from the Y axis (ring, helix)
       flat   — every plate shares one normal (grid)
       camera — soft billboard, blended toward the camera each frame (drift)

     yaw:
       spin — keep turning; safe when every plate re-faces the camera anyway
       sway — oscillate inside yawLimit. A flat grid turned by a free spin
              goes edge-on and the back-face fade erases the whole formation;
              it has to stay roughly square to the camera. */
  ring:  { fn: ring,  facing: 'radial', drift: 0.055, tumble: 0.10, yaw: 'spin' },
  /* Radial on a spiral points most plates sideways, and the back-face fade
     then erased two thirds of them. A helix has to billboard to stay legible. */
  helix: { fn: helix, facing: 'camera', drift: 0.040, tumble: 0.14, yaw: 'spin' },
  grid:  { fn: grid,  facing: 'flat',   drift: 0.018, tumble: 0.04, yaw: 'sway', yawLimit: 0.5 },
  drift: { fn: drift, facing: 'camera', drift: 0.075, tumble: 0.22, yaw: 'spin' },
};

export const FORMATION_IDS = ['ring', 'helix', 'grid', 'drift'];

/**
 * Positions for every card, plus the radius the scene must frame.
 * @param {string} id
 * @param {number} n
 * @param {boolean} portrait
 */
export function buildLayout(id, n, portrait) {
  const spec = FORMATIONS[id] || FORMATIONS.ring;
  const slots = [];
  let hw = 0, hh = 0, hd = 0;
  for (let i = 0; i < n; i++) {
    const s = spec.fn(i, n, portrait);
    slots.push(s);
    hw = Math.max(hw, Math.abs(s.x));
    hh = Math.max(hh, Math.abs(s.y));
    hd = Math.max(hd, Math.abs(s.z));
  }
  /* Half-diagonal of a plate, so a card at the rim is framed whole rather
     than clipped at its corner — and reported per axis, not as one sphere.
     A ring is a flat disc: framing its bounding *sphere* reserved as much
     height as width and left two thirds of a landscape screen empty. */
  const reach = Math.hypot(CARD_W, CARD_H) / 2 + spec.drift;
  return {
    slots,
    facing: spec.facing,
    drift: spec.drift,
    tumble: spec.tumble,
    yaw: spec.yaw,
    yawLimit: spec.yawLimit || 0,
    /* Which way the formation turns. The upright ring is a wheel in YZ, so a
       swipe up-and-down has to roll it; everything else turns around Y. */
    axis: id === 'ring' && portrait ? 'x' : 'y',
    reach,
    halfW: hw + reach,
    halfH: hh + reach,
    halfD: hd + reach,
  };
}
