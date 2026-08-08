/* ==========================================================================
   scene.js — the fluid gallery itself.

   The camera never moves on its own: it sits on +Z and always frames the
   bounding sphere the current layout reports. Everything the visitor does
   (drag, pinch, formation change) moves the *group*, not the camera. That is
   what keeps portrait honest — reframing is one number, recomputed on resize.
   ========================================================================== */

import * as THREE from 'three';
import { buildLayout, CARD_W, CARD_H } from './formations.js';
import { drawPlate } from './plate.js';
import { detectQuality, createWatchdog } from '../lib/quality.js';

/* Three.js fixes the *vertical* field of view and lets the horizontal one
   follow the aspect ratio. On a phone held upright that collapses the
   horizontal view to a telephoto crop — the flythrough build lost whole
   subjects off-screen to exactly this. Opening the vertical FOV until the
   horizontal one clears MIN_H_FOV is the same fix, kept here on purpose. */
const BASE_V_FOV = 42;
const MIN_H_FOV = 46 * (Math.PI / 180);
const FRAME_MARGIN = 1.03;

const PITCH_LIMIT = 0.42;
const DAMP = 0.085;

export function createScene(canvas, lenses, opts = {}) {
  const q = detectQuality();
  if (!q.webgl) return null;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: q.antialias,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(q.pixelRatio);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(BASE_V_FOV, 1, 0.1, 200);
  const group = new THREE.Group();
  scene.add(group);

  const dummy = new THREE.Object3D();
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();

  let palette = readPalette();
  scene.fog = new THREE.FogExp2(palette.fogHex, 0.028);
  scene.background = new THREE.Color(palette.fogHex);

  /* ── Cards ──────────────────────────────────────────────────────────── */

  const plateW = q.textureSize === 256 ? 384 : 640;
  const cards = lenses.map((lens, i) => {
    const tex = new THREE.CanvasTexture(drawPlate(lens, palette.plate(plateW)));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W, CARD_H), mat);
    mesh.userData = { index: i, lens };
    group.add(mesh);
    return { mesh, mat, tex, base: new THREE.Quaternion(), target: new THREE.Vector3(), hover: 0, phase: i * 1.7 };
  });

  /* ── Layout / framing ───────────────────────────────────────────────── */

  let formation = opts.formation || 'ring';
  let layout = null;
  let portrait = false;
  let reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function applyLayout(instant) {
    const prev = layout;
    layout = buildLayout(formation, cards.length, portrait);

    /* Coming into a yaw-limited formation from a free spin, the group can be
       anywhere — including edge-on. Bring it back inside the limit instead of
       presenting a grid the visitor cannot read. */
    if (layout.yawLimit && (!prev || prev.yaw !== 'sway')) {
      yawTo = 0;
      yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));   // shortest way home
    }
    /* Leaving the wheel, pitch can be several turns deep — it is unclamped
       while it is the driving axis. Anything else would come back tilted. */
    if (prev && prev.axis !== layout.axis) {
      if (layout.axis === 'y') { pitchTo = 0; pitch = Math.atan2(Math.sin(pitch), Math.cos(pitch)); }
      else { yawTo = 0; }
    }

    layout.slots.forEach((s, i) => {
      const c = cards[i];
      c.target.set(s.x, s.y, s.z);
      c.base.setFromEuler(new THREE.Euler(s.rx, s.ry, s.rz));
      if (instant || reduced) {
        c.mesh.position.copy(c.target);
        c.mesh.quaternion.copy(c.base);
      }
    });
    frame();
  }

  /** Closest the camera can sit with every plate still fully on screen.

      Solved per card rather than from a bounding volume. A ring's widest
      cards sit at z = 0, not at the near edge, so adding the layout's depth
      to a box fit pushed the camera back by the ring's whole radius and left
      half the frame empty. Each card is only as demanding as its own x, y
      and z make it. */
  function frame() {
    if (!layout) return;
    const vHalf = THREE.MathUtils.degToRad(camera.fov) / 2;
    const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
    /* Shrink the usable frame rather than the layout: the switcher owns the
       bottom of the screen and the meta corners own the top, so a plate that
       fits the viewport exactly still lands underneath the chrome. */
    const tanH = Math.tan(hHalf) * 0.94;
    const tanV = Math.tan(vHalf) * 0.84;
    const r = layout.reach;
    let d = 0;
    for (const s of layout.slots) {
      d = Math.max(
        d,
        (Math.abs(s.x) + r) / tanH + s.z,
        (Math.abs(s.y) + r) / tanV + s.z,
      );
    }
    camera.position.set(0, 0, d * FRAME_MARGIN);
    camera.lookAt(0, 0, 0);
  }

  function resize() {
    const w = window.innerWidth;
    const hgt = window.innerHeight;
    const aspect = w / hgt;
    portrait = aspect < 0.9;

    camera.aspect = aspect;
    /* Open the vertical FOV until the horizontal one clears the floor. */
    const needed = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(MIN_H_FOV / 2) / aspect));
    camera.fov = Math.max(BASE_V_FOV, needed);
    camera.updateProjectionMatrix();

    renderer.setSize(w, hgt, false);
    applyLayout(true);
  }

  /* ── Interaction ────────────────────────────────────────────────────── */

  const pointers = new Map();
  let yaw = 0, pitch = 0, yawTo = 0, pitchTo = 0;
  let spin = 0.055;                     // idle drift, radians/sec
  let idleUntil = 0;
  let dragging = false, moved = 0;
  let pinchFrom = 0, zoom = 1, zoomTo = 1;
  let hovered = null;

  const listeners = { hover: () => {}, pick: () => {}, drag: () => {} };

  function pointerAngle() {
    const a = [...pointers.values()];
    return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
  }

  canvas.addEventListener('pointerdown', (e) => {
    /* Capture is an optimisation, not a requirement — and it throws on a
       pointerId the browser does not own. Losing it must not lose the drag. */
    try { canvas.setPointerCapture(e.pointerId); } catch { /* keep going */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragging = true;
    moved = 0;
    idleUntil = performance.now() + 4000;
    if (pointers.size === 2) pinchFrom = pointerAngle();
    listeners.drag(true);
  });

  canvas.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    pointerNdc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);

    if (prev && dragging) {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      prev.x = e.clientX; prev.y = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);

      if (pointers.size === 2) {
        const now = pointerAngle();
        if (pinchFrom) zoomTo = THREE.MathUtils.clamp(zoomTo * (pinchFrom / now), 0.72, 1.45);
        pinchFrom = now;
      } else if (layout.axis === 'x') {
        /* Wheel: the vertical swipe is the one that turns it. */
        pitchTo -= dy * 0.006;
        yawTo = THREE.MathUtils.clamp(yawTo - dx * 0.003, -0.3, 0.3);
      } else {
        yawTo -= dx * 0.006;
        if (layout.yawLimit) yawTo = THREE.MathUtils.clamp(yawTo, -layout.yawLimit, layout.yawLimit);
        pitchTo = THREE.MathUtils.clamp(pitchTo - dy * 0.004, -PITCH_LIMIT, PITCH_LIMIT);
      }
      idleUntil = performance.now() + 4000;
    }
  });

  function endPointer(e) {
    const wasDragging = dragging;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchFrom = 0;
    if (pointers.size === 0) {
      dragging = false;
      listeners.drag(false);
      /* A tap is a drag that went nowhere. 10px of slop covers the wobble a
         thumb adds on a phone without swallowing real drags. */
      if (wasDragging && moved < 10 && hovered) listeners.pick(hovered.userData.lens, hovered.userData.index);
    }
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomTo = THREE.MathUtils.clamp(zoomTo + e.deltaY * 0.0011, 0.72, 1.45);
    idleUntil = performance.now() + 4000;
  }, { passive: false });

  /* ── Loop ───────────────────────────────────────────────────────────── */

  const clock = new THREE.Clock();
  const watchdog = createWatchdog((step) => {
    if (step === 1) renderer.setPixelRatio(Math.max(1, q.pixelRatio * 0.8));
    if (step === 2) renderer.setPixelRatio(1);
  });

  const camLocal = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const toCam = new THREE.Vector3();
  const invQ = new THREE.Quaternion();
  let running = true;

  function tick() {
    if (!running) return;
    requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);
    watchdog(dt * 1000);

    if (!dragging && performance.now() > idleUntil && !reduced) {
      if (layout.yaw === 'sway') yawTo = Math.sin(clock.elapsedTime * 0.22) * layout.yawLimit * 0.55;
      else if (layout.axis === 'x') pitchTo += spin * dt;
      else yawTo += spin * dt;
    }

    yaw += (yawTo - yaw) * DAMP;
    pitch += (pitchTo - pitch) * DAMP;
    zoom += (zoomTo - zoom) * DAMP;
    group.rotation.set(pitch, yaw, 0);
    group.scale.setScalar(zoom);

    /* Camera position in group space, for the billboard-ish formations. */
    invQ.copy(group.quaternion).invert();
    camLocal.copy(camera.position).applyQuaternion(invQ).divideScalar(zoom || 1);

    const t = clock.elapsedTime;
    for (const c of cards) {
      const wobble = layout.drift;
      c.mesh.position.x += (c.target.x + Math.sin(t * 0.5 + c.phase) * wobble - c.mesh.position.x) * DAMP;
      c.mesh.position.y += (c.target.y + Math.cos(t * 0.42 + c.phase) * wobble - c.mesh.position.y) * DAMP;
      c.mesh.position.z += (c.target.z + Math.sin(t * 0.37 + c.phase * 1.3) * wobble - c.mesh.position.z) * DAMP;

      let want = c.base;
      if (layout.facing === 'camera') {
        dummy.position.copy(c.mesh.position);
        dummy.lookAt(camLocal);
        want = dummy.quaternion.clone().slerp(c.base, 0.25);
      } else if (layout.tumble) {
        dummy.quaternion.copy(c.base);
        dummy.rotateZ(Math.sin(t * 0.3 + c.phase) * layout.tumble * 0.12);
        want = dummy.quaternion;
      }
      c.mesh.quaternion.slerp(want, reduced ? 1 : 0.09);

      const lift = c.hover;
      c.mesh.scale.setScalar(1 + lift * 0.09);

      /* Dim with colour, not alpha — semi-transparent plates read as washed
         out rather than recessed. Alpha is reserved for the one job it is
         actually needed for below. */
      c.mat.color.setScalar(0.70 + lift * 0.30);

      /* Plates are DoubleSide so the far half of a ring is not a hole, but a
         plate seen from behind shows its text mirrored. Fading by how squarely
         it faces the camera hides that without popping cards in and out. */
      normal.set(0, 0, 1).applyQuaternion(c.mesh.quaternion);
      toCam.copy(camLocal).sub(c.mesh.position).normalize();
      const face = normal.dot(toCam);
      c.mat.opacity = THREE.MathUtils.clamp((face + 0.10) / 0.45, 0.04, 1);
    }

    if (!dragging) {
      raycaster.setFromCamera(pointerNdc, camera);
      /* Skip plates that faded out facing away: a card you cannot read is not
         a card you should be able to click through the ring. */
      const hit = raycaster
        .intersectObjects(group.children, false)
        .find((x) => x.object.material.opacity > 0.35);
      const next = hit ? hit.object : null;
      if (next !== hovered) {
        hovered = next;
        if (opts.fine) listeners.hover(hovered ? hovered.userData.lens : null);
      }
    }

    for (const c of cards) {
      /* Idle sits high on purpose: with nothing hovered every plate should
         look lit, not half-dimmed waiting for attention. */
      const on = hovered === c.mesh ? 1 : hovered ? 0 : 0.72;
      c.hover += (on - c.hover) * 0.12;
    }

    renderer.render(scene, camera);
  }

  /* ── Palette ────────────────────────────────────────────────────────── */

  function readPalette() {
    const cs = getComputedStyle(document.body);
    const field = cs.getPropertyValue('--field').trim() || '#0a0908';
    const ink = cs.getPropertyValue('--ink').trim() || '#f3ede0';
    const dark = document.body.dataset.mode !== 'paper';
    return {
      fogHex: field,
      plate: (w) => ({
        width: w,
        ink,
        dim: dark ? 'rgba(243,237,224,0.5)' : 'rgba(20,17,13,0.55)',
        line: dark ? 'rgba(243,237,224,0.22)' : 'rgba(20,17,13,0.24)',
        /* Measured, not guessed: at #211d19/#100e0c the plates sat within a
           few percent of the fog colour and the ring read as a smudge. The
           plate has to stay clearly above the field it floats in. */
        plateHi: dark ? '#3b352d' : '#f7f2e8',
        plateLo: dark ? '#1d1a16' : '#d8cfba',
      }),
    };
  }

  function refreshPalette() {
    palette = readPalette();
    scene.fog.color.set(palette.fogHex);
    scene.background.set(palette.fogHex);
    cards.forEach((c, i) => {
      c.tex.image = drawPlate(lenses[i], palette.plate(plateW));
      c.tex.needsUpdate = true;
    });
  }

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  resize();
  tick();

  return {
    setFormation(id) { formation = id; applyLayout(false); },
    refreshPalette,
    on(name, fn) { listeners[name] = fn; },
    focus(index) {
      /* Turn the requested card to the front rather than teleporting to it. */
      const s = layout.slots[index];
      if (!s) return;
      if (layout.axis === 'x') pitchTo = Math.atan2(s.y, s.z);
      else if (!layout.yawLimit) yawTo = -Math.atan2(s.x, s.z);
      idleUntil = performance.now() + 6000;
    },
    destroy() { running = false; renderer.dispose(); },
    tier: q.tier,
  };
}
