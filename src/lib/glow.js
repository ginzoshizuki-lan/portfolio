/* ==========================================================================
   glow.js — the light itself, as geometry.
   There are no shadow maps in this scene. At 60–70 m slab heights a shadow
   map is either blotchy or ruinously expensive, and the thing that actually
   sells "light through a fissure" is the visible shaft and the pool it lands
   in. Both are authored here as additive quads, which cost almost nothing and
   can be placed exactly where the composition needs them.
   ========================================================================== */

import * as THREE from 'three';
import { createShaftTexture, createPoolTexture } from './textures.js';

const shaftTex = /* @__PURE__ */ createShaftTexture();
const poolTex = /* @__PURE__ */ createPoolTexture();

function additive(texture, color, opacity) {
  return new THREE.MeshBasicMaterial({
    map: texture,
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

/**
 * A vertical curtain of light. Two crossed quads so it holds up when the
 * camera passes through it — a single billboard flips inside out.
 * @param {object} o
 * @param {number} o.width   metres across
 * @param {number} o.height  metres of fall
 * @param {number[]} o.at    [x, y, z] — y is the TOP of the shaft
 */
export function lightShaft({
  width = 6,
  height = 40,
  at = [0, 40, 0],
  color = 0xdfe4ea,
  opacity = 0.5,
  rotY = 0,
  crossed = true,
} = {}) {
  const group = new THREE.Group();
  const mat = additive(shaftTex, color, opacity);
  const geo = new THREE.PlaneGeometry(width, height);

  const a = new THREE.Mesh(geo, mat);
  group.add(a);
  if (crossed) {
    const b = new THREE.Mesh(geo, mat);
    b.rotation.y = Math.PI / 2;
    group.add(b);
  }

  group.position.set(at[0], at[1] - height / 2, at[2]);
  group.rotation.y += rotY;
  group.renderOrder = 2;
  return group;
}

/**
 * The bright patch where a shaft meets the floor (or any surface).
 * Laid flat by default; pass rotX = 0 to hang it on a wall.
 */
export function lightPool({
  size = 14,
  at = [0, 0.06, 0],
  color = 0xe6ebf0,
  opacity = 0.6,
  rotX = -Math.PI / 2,
  rotY = 0,
  aspect = 1,
} = {}) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(size * aspect, size),
    additive(poolTex, color, opacity),
  );
  mesh.position.set(...at);
  mesh.rotation.set(rotX, rotY, 0);
  mesh.renderOrder = 1;
  return mesh;
}

/**
 * A hard-edged emissive slot — the aperture itself, seen straight on.
 * This is what the bloom pass picks up.
 */
export function lightSlot({
  width = 1,
  height = 10,
  at = [0, 10, 0],
  color = 0xf3ede0,
  opacity = 0.92,
  rotY = 0,
  rotX = 0,
} = {}) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  );
  mesh.position.set(...at);
  mesh.rotation.set(rotX, rotY, 0);
  mesh.renderOrder = 3;
  return mesh;
}

/**
 * A contact shadow — the dark patch where a mass meets the floor.
 * There are no shadow maps here, and without this every slab looks like it is
 * hovering. Black, with the radial texture driving alpha rather than colour,
 * so it darkens the floor instead of tinting it.
 */
export function contactShadow({
  size = 14,
  at = [0, 0.04, 0],
  opacity = 0.55,
  aspect = 1,
} = {}) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(size * aspect, size),
    new THREE.MeshBasicMaterial({
      color: 0x000000,
      alphaMap: poolTex,
      transparent: true,
      opacity,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  mesh.position.set(...at);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 0;   // beneath the additive light pools
  return mesh;
}

/** A canvas-texture decal (inscriptions, numerals) sitting on a stone face. */
export function decal(texture, {
  width = 6,
  height = 3,
  at = [0, 6, 0],
  rotY = 0,
  opacity = 0.85,
} = {}) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  mesh.position.set(...at);
  mesh.rotation.y = rotY;
  mesh.renderOrder = 3;
  return mesh;
}
