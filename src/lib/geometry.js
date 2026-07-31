/* ==========================================================================
   geometry.js — slab construction.
   Everything in the building is a box. The two things that make boxes read
   as monumental concrete rather than as programmer art:
     1. constant texel density regardless of slab size (rescaleBoxUVs)
     2. all slabs merged into one draw call per zone (buildMass)
   ========================================================================== */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** One texture tile per METERS_PER_TILE metres of surface. */
const METERS_PER_TILE = 7;

/* BoxGeometry emits 6 faces × 4 vertices, in the order
   +X, -X, +Y, -Y, +Z, -Z. Each face's UV spans 0..1, so a 60 m slab and a
   2 m slab get the same number of texture tiles unless we rescale here. */
function rescaleBoxUVs(geo, w, h, d) {
  const uv = geo.attributes.uv;
  const faceSpans = [
    [d, h], [d, h], // ±X
    [w, d], [w, d], // ±Y
    [w, h], [w, h], // ±Z
  ];

  for (let face = 0; face < 6; face++) {
    const [su, sv] = faceSpans[face];
    const ru = su / METERS_PER_TILE;
    const rv = sv / METERS_PER_TILE;
    for (let v = 0; v < 4; v++) {
      const i = face * 4 + v;
      uv.setXY(i, uv.getX(i) * ru, uv.getY(i) * rv);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

/**
 * A single slab, ready to be merged.
 * @param {number[]} size  [width, height, depth] in metres
 * @param {number[]} at    [x, y, z] centre — NOT the base, so add h/2 yourself
 * @param {number}   rotY  yaw in radians
 */
export function slab(size, at, rotY = 0) {
  const [w, h, d] = size;
  const geo = new THREE.BoxGeometry(w, h, d);
  rescaleBoxUVs(geo, w, h, d);
  if (rotY) geo.rotateY(rotY);
  geo.translate(at[0], at[1], at[2]);
  return geo;
}

/** Same as slab() but positioned by its base rather than its centre. */
export function pier(size, at, rotY = 0) {
  return slab(size, [at[0], at[1] + size[1] / 2, at[2]], rotY);
}

/**
 * Merge a pile of slab geometries into one mesh.
 * Non-indexed on purpose: merging indexed boxes of differing vertex counts is
 * fine, but dropping the index keeps the merge cheap and the meshes are static.
 */
export function buildMass(geometries, material, name = 'mass') {
  const merged = mergeGeometries(geometries, false);
  geometries.forEach((g) => g.dispose());
  merged.computeVertexNormals();
  const mesh = new THREE.Mesh(merged, material);
  mesh.name = name;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}
