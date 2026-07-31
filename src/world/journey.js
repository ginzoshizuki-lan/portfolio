/* ==========================================================================
   journey.js — the camera rail.

   Two Catmull-Rom curves: one the eye travels, one the gaze follows. Aiming
   at a second curve rather than at the tangent is what lets the camera turn
   its head — look up at a pier, back at the shaft — while still moving
   forward. Forward is non-negotiable: z increases at every waypoint, because
   a camera that reverses while the user scrolls down reads as a bug.

   Waypoint i sits exactly at curve parameter t = i / (n - 1), so the mapping
   from scroll position to waypoint index is explicit and editable: `w` is how
   much scroll the segment INTO that waypoint consumes.
   ========================================================================== */

import * as THREE from 'three';

const WAYPOINTS = [
  /*  0 */ { eye: [0, 2.4, -120], look: [0, 15, 22], w: 0 },
  /*  1 */ { eye: [0, 2.4, -74], look: [0, 12, 22], w: 1.20 },
  /*  2 */ { eye: [-1.2, 2.2, -26], look: [0, 9, 30], w: 0.95 },
  /*  3 */ { eye: [0.6, 2.0, 14], look: [0.4, 7, 52], w: 0.85 },
  /*  4 */ { eye: [-0.8, 2.1, 48], look: [0.6, 11, 84], w: 0.90 },
  /* Each look-target sits just inboard of the pier that waypoint belongs to,
     which puts the pier slightly off-centre — on the opposite side from its
     card — instead of dead ahead blocking the depth of the hall.
     `narrow` centres the pier instead: on a phone the card stacks BELOW the
     viewport rather than beside it, and the frame is too narrow to hold an
     off-axis subject at all. The narrow variants also aim LOWER, which
     lifts the pier and its numeral into the top of the frame — on a phone
     the card occupies the bottom half. */
  /* The slalom starts only AFTER the fissure opens into the hall at z=78.
     Beginning the swing at z=86 made the curve drift to x=-7.7 while still
     inside the 7 m slot, so the camera left through the corridor wall.
     Likewise wp9 returns to the centre line early: the chamber portal is a
     14 m doorway, and arriving at x=5 drove the camera through the wall
     beside it rather than through the opening. */
  /*  5 */ { eye: [0, 2.5, 88], look: [-14, 9, 120], narrow: [-20, 3, 120], w: 0.90 },
  /*  6 */ { eye: [-8, 2.5, 122], look: [14, 8, 160], narrow: [20, 2.5, 160], w: 0.85 },
  /*  7 */ { eye: [9, 2.6, 158], look: [-14, 9, 200], narrow: [-20, 3, 200], w: 0.85 },
  /*  8 */ { eye: [-9, 2.5, 200], look: [14, 8, 240], narrow: [20, 2.5, 240], w: 0.85 },
  /*  9 */ { eye: [2, 2.4, 238], look: [0, 9, 266], w: 0.85 },
  /* Chamber: the camera orbits at ~20 m while the monoliths sit at ~7 m from
     the shaft, so each one becomes a backlit subject at a comfortable size.
     An earlier pass had the orbit tighter and put a monolith directly on the
     sightline — from 6 m a 6 m slab is just a grey wall filling the frame. */
  /* The gaze stays on the shaft, not on a monolith. Aiming at the monoliths
     put one 15 m from the lens filling the frame; letting them flank the
     light instead keeps the room legible and still silhouettes them. */
  /* 10 */ { eye: [0, 2.3, 266], look: [0, 9, 292], w: 0.75 },
  /* 11 */ { eye: [-23, 2.6, 280], look: [-2, 9, 296], w: 0.85 },
  /* 12 */ { eye: [-22, 2.7, 306], look: [0, 8, 298], w: 0.80 },
  /* 13 */ { eye: [18, 2.6, 316], look: [0, 9, 299], w: 0.85 },
  /* 14 */ { eye: [3, 2.4, 324], look: [0, 11, 356], w: 0.75 },
  /* Ascent: the subject here is the climb itself. The portrait moved to the
     HTML overlay, so there is no longer an object in the wall to aim at. */
  /* 15 */ { eye: [0, 8.4, 346], look: [-4, 18, 376], w: 0.90 },
  /* 16 */ { eye: [2, 19.4, 370], look: [3, 30, 402], w: 0.85 },
  /* 17 */ { eye: [0, 32.6, 398], look: [16, 36, 428], w: 0.85 },
  /* 18 */ { eye: [-6, 32.6, 424], look: [16, 38, 448], w: 0.90 },
  /* Aperture: stays inside the 16 m slot to the end. Flying clear of the
     structure left nothing in frame for the light to fall on. */
  /* 19 */ { eye: [0, 33.0, 458], look: [0, 40, 500], w: 0.85 },
  /* 20 */ { eye: [0, 38, 496], look: [0, 46, 545], w: 0.95 },
  /* 21 */ { eye: [0, 44, 528], look: [0, 52, 590], w: 0.85 },
];

/** HUD chapter titles, keyed by the waypoint each one begins at. */
const STATIONS = [
  { at: 0, num: '01', name: 'Approach', key: 'hero' },
  { at: 2.6, num: '02', name: 'Fissure', key: 'intro' },
  { at: 4.7, num: '03', name: 'Colonnade', key: 'works' },
  { at: 9.6, num: '04', name: 'Chamber', key: 'beliefs' },
  { at: 13.7, num: '05', name: 'Ascent', key: 'profile' },
  { at: 17.0, num: '06', name: 'Archive', key: 'writings' },
  { at: 19.3, num: '07', name: 'Aperture', key: 'contact' },
];

/** Scroll positions the nav jumps to, as waypoint indices. */
const ANCHORS = {
  hero: 0.2, intro: 3.2, works: 5.1, beliefs: 10.0,
  profile: 15.0, writings: 18.0, contact: 20.2,
};

export function createJourney() {
  const eyePts = WAYPOINTS.map((k) => new THREE.Vector3(...k.eye));
  const lookPts = WAYPOINTS.map((k) => new THREE.Vector3(...k.look));
  /* portrait-screen variant; identical wherever no `narrow` is given */
  const narrowPts = WAYPOINTS.map((k) => new THREE.Vector3(...(k.narrow ?? k.look)));

  const eyeCurve = new THREE.CatmullRomCurve3(eyePts, false, 'catmullrom', 0.4);
  /* Low tension on the gaze. The look targets alternate hard left/right down
     the colonnade, and at 0.5 the spline overshot each knot badly — the camera
     was already swinging right while the card for the left-hand pier was up,
     throwing that pier to the opposite edge of the frame. */
  const lookCurve = new THREE.CatmullRomCurve3(lookPts, false, 'catmullrom', 0.18);
  const narrowCurve = new THREE.CatmullRomCurve3(narrowPts, false, 'catmullrom', 0.18);

  /* cumulative scroll → waypoint index table */
  const cum = [0];
  for (let i = 1; i < WAYPOINTS.length; i++) cum.push(cum[i - 1] + WAYPOINTS[i].w);
  const total = cum[cum.length - 1];
  const norm = cum.map((c) => c / total);

  const lastIndex = WAYPOINTS.length - 1;

  /** scroll progress 0..1 → fractional waypoint index */
  function waypointAt(p) {
    const q = Math.min(1, Math.max(0, p));
    for (let i = 1; i <= lastIndex; i++) {
      if (q <= norm[i]) {
        const span = norm[i] - norm[i - 1] || 1;
        return (i - 1) + (q - norm[i - 1]) / span;
      }
    }
    return lastIndex;
  }

  /** fractional waypoint index → scroll progress 0..1 (inverse of the above) */
  function scrollAt(wp) {
    const i = Math.min(lastIndex, Math.max(0, wp));
    const lo = Math.floor(i);
    const hi = Math.min(lastIndex, lo + 1);
    return norm[lo] + (norm[hi] - norm[lo]) * (i - lo);
  }

  const _eye = new THREE.Vector3();
  const _look = new THREE.Vector3();
  const _narrow = new THREE.Vector3();

  /* 1 on a 16:9-or-wider screen, 0 on a portrait phone, blended between. */
  function widescreenFactor(aspect) {
    return THREE.MathUtils.clamp((aspect - 0.8) / (1.45 - 0.8), 0, 1);
  }

  /**
   * Place the camera for a given scroll progress.
   * `drift` is the pointer parallax, in the range -1..1 on each axis.
   */
  function apply(camera, p, time, drift) {
    const wp = waypointAt(p);
    const t = wp / lastIndex;

    eyeCurve.getPoint(t, _eye);
    lookCurve.getPoint(t, _look);
    const wide = widescreenFactor(camera.aspect);
    if (wide < 0.999) {
      narrowCurve.getPoint(t, _narrow);
      _look.lerpVectors(_narrow, _look, wide);
    }

    /* a slow breath so a stalled scroll never looks like a frozen frame */
    _eye.y += Math.sin(time * 0.00042) * 0.16;
    _eye.x += Math.sin(time * 0.00031 + 1.7) * 0.12;

    /* pointer parallax: the head turns, the body doesn't */
    _look.x += drift.x * 5.5;
    _look.y -= drift.y * 3.2;

    camera.position.copy(_eye);
    camera.lookAt(_look);

    /* A touch of roll into the lateral turns — reads as momentum.
       Applied with rotateZ, not `rotation.z +=`: lookAt can land in either
       Euler branch (z near 0 or near ±π for the same orientation), so adding
       to the component flips the roll's sign depending on the branch, and can
       snap when the decomposition switches mid-turn. rotateZ is a rotation
       about the local view axis and is branch-independent. */
    const ahead = waypointAt(Math.min(1, p + 0.004));
    const lateral = eyeCurve.getPoint(ahead / lastIndex).x - _eye.x;
    camera.rotateZ(THREE.MathUtils.clamp(-lateral * 0.03, -0.035, 0.035));

    return wp;
  }

  function stationFor(wp) {
    let found = STATIONS[0];
    for (const s of STATIONS) if (wp >= s.at) found = s;
    return found;
  }

  return {
    lastIndex,
    apply,
    waypointAt,
    scrollAt,
    stationFor,
    anchorScroll: (key) => scrollAt(ANCHORS[key] ?? 0),
    /* Total scroll length in viewport heights. 22 meant roughly 240 wheel
       notches to reach the end, which read as the page being heavy rather
       than as the journey being long. */
    scrollHeights: 14,
  };
}
