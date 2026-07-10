// Matrix builders for InstancedMesh rendering. Each primitive is drawn from a
// UNIT base geometry (radius/height 1) and placed per-instance by composing a
// transform into the instance matrix — so one draw call covers thousands of
// pipes/joint parts, and the transforms are updated imperatively each frame
// (from the eased render positions) without re-rendering React. See PipeLayer
// and InstancedFreeHubs. Module-scoped scratch objects avoid per-instance
// allocation in the per-frame loop.
import {
  InstancedBufferAttribute,
  type InstancedMesh,
  type Material,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import type { Vec3 } from '../../schema';

const WORLD_UP = new Vector3(0, 1, 0);
const WORLD_FWD = new Vector3(0, 0, 1);

const _a = new Vector3();
const _b = new Vector3();
const _dir = new Vector3();
const _pos = new Vector3();
const _q = new Quaternion();
const _s = new Vector3();

/** Matrix for a unit-Y cylinder (radius 1, height 1) spanning a→b at radius r.
 * Returns false and leaves `out` untouched for a degenerate (zero-length)
 * segment. */
export function cylinderMatrix(out: Matrix4, a: Vec3, b: Vec3, r: number): boolean {
  _a.set(a.x, a.y, a.z);
  _b.set(b.x, b.y, b.z);
  _dir.subVectors(_b, _a);
  const len = _dir.length();
  if (len < 1e-6) return false;
  _dir.multiplyScalar(1 / len);
  _q.setFromUnitVectors(WORLD_UP, _dir);
  _pos.addVectors(_a, _b).multiplyScalar(0.5);
  _s.set(r, len, r);
  out.compose(_pos, _q, _s);
  return true;
}

/** Matrix for a unit sphere (radius 1) centred at `c`, scaled to radius `r`. */
export function sphereMatrix(out: Matrix4, c: Vec3, r: number): void {
  _pos.set(c.x, c.y, c.z);
  _q.identity();
  _s.set(r, r, r);
  out.compose(_pos, _q, _s);
}

/** Matrix for a unit +Z-facing ring (a torus in the XY plane, axis +Z) centred
 * at `c`, turned to face along `dir`, uniformly scaled by `s`. */
export function ringMatrix(out: Matrix4, c: Vec3, dir: Vec3, s: number): void {
  _dir.set(dir.x, dir.y, dir.z);
  if (_dir.lengthSq() < 1e-12) _q.identity();
  else _q.setFromUnitVectors(WORLD_FWD, _dir.normalize());
  _pos.set(c.x, c.y, c.z);
  _s.set(s, s, s);
  out.compose(_pos, _q, _s);
}

/** Matrix for a unit-Y cone (radius 1, height 1, apex +Y) at `c`, pointing along
 * `dir`, scaled to base radius `r` and height `h`. */
export function coneMatrix(out: Matrix4, c: Vec3, dir: Vec3, r: number, h: number): void {
  _dir.set(dir.x, dir.y, dir.z);
  if (_dir.lengthSq() < 1e-12) _q.identity();
  else _q.setFromUnitVectors(WORLD_UP, _dir.normalize());
  _pos.set(c.x, c.y, c.z);
  _s.set(r, h, r);
  out.compose(_pos, _q, _s);
}

const _ex = new Vector3();
const _ey = new Vector3();
const _ez = new Vector3();
const _t = new Matrix4();

/** Matrix placing a primitive baked in the wrapped-joint LOCAL frame (X = radial
 * toward the branch `er`, Y = receiver axis `u`, Z = cross(er, u)) into the
 * world at `node`, uniformly scaled by `s`. The frame MUST be right-handed:
 * the canonical arrow is baked in world space at er=+X / u=+Y, so that exact
 * configuration must map through the IDENTITY — a cross(u, er) basis is a
 * mirror and renders every wrap helix wound the wrong way ("wrong angle").
 * `localPre`, if given, is right-multiplied — for a primitive (e.g. the
 * arrowhead) baked at a fixed offset inside that frame. */
export function wrapFrameMatrix(
  out: Matrix4,
  node: Vec3,
  er: Vec3,
  u: Vec3,
  s: number,
  localPre?: Matrix4,
): void {
  _ex.set(er.x, er.y, er.z);
  _ey.set(u.x, u.y, u.z);
  _ez.crossVectors(_ex, _ey); // right-handed: ez = ex × ey (identity at the bake pose)
  out.makeBasis(_ex, _ey, _ez);
  out.scale(_s.set(s, s, s));
  if (localPre) out.multiply(localPre);
  // translate to `node` WITHOUT clobbering the localPre offset (premultiply)
  out.premultiply(_t.makeTranslation(node.x, node.y, node.z));
}

/** A collapsed (zero-scale) matrix, used to hide a spare instance slot. */
export function hideMatrix(out: Matrix4): void {
  out.makeScale(0, 0, 0);
}

// ── per-instance alpha (ghosting everything OUTSIDE an entered group) ─────────
// InstancedMesh has per-instance colour but no per-instance opacity, so dimming
// a subset of one instanced draw call needs a tiny shader patch: a 1-float
// `aInstanceAlpha` InstancedBufferAttribute on the geometry, injected into the
// EXISTING material's fragment alpha via onBeforeCompile (no duplicate meshes,
// no second material). The dim state changes only on enter/exit group, so the
// attribute is (re)written in a useEffect — never per frame.

/** Ghost alpha for everything outside the entered group — clearly visible but
 * unmistakably inactive. Shared by instanced AND declarative (JointLayer /
 * FormedLayer) dimming so the whole scene ghosts consistently. */
export const GROUP_DIM_ALPHA = 0.18;

/** `onBeforeCompile` patch multiplying the fragment alpha by the per-instance
 * `aInstanceAlpha` attribute. Pass THIS module-scoped function identity to every
 * patched material (three's default `customProgramCacheKey` is
 * `onBeforeCompile.toString()`, so sharing the function shares the program). */
export function instanceAlphaPatch(shader: { vertexShader: string; fragmentShader: string }): void {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      '#include <common>\nattribute float aInstanceAlpha;\nvarying float vInstanceAlpha;',
    )
    .replace(
      '#include <begin_vertex>',
      'vInstanceAlpha = aInstanceAlpha;\n#include <begin_vertex>',
    );
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vInstanceAlpha;')
    .replace(
      '#include <color_fragment>',
      '#include <color_fragment>\ndiffuseColor.a *= vInstanceAlpha;',
    );
}

/** Write per-instance alphas into the mesh geometry's `aInstanceAlpha`
 * attribute (created/resized as needed — the patched shader reads 0 = invisible
 * if it's missing, so ALWAYS call this once after (re)mount). Unless
 * `keepTransparent` (for materials that are transparent by design), the
 * material's `transparent` flag is toggled on only while some instance is
 * actually dimmed, so the fully-opaque steady state keeps the opaque pass. */
export function setInstanceAlphas(
  mesh: InstancedMesh,
  alphaOf: (i: number) => number,
  opts?: { keepTransparent?: boolean },
): void {
  const count = mesh.count;
  let attr = mesh.geometry.getAttribute('aInstanceAlpha') as InstancedBufferAttribute | undefined;
  if (!attr || attr.count !== count) {
    attr = new InstancedBufferAttribute(new Float32Array(count), 1);
    mesh.geometry.setAttribute('aInstanceAlpha', attr);
  }
  const arr = attr.array as Float32Array;
  let anyDim = false;
  for (let i = 0; i < count; i++) {
    const a = alphaOf(i);
    arr[i] = a;
    if (a < 1) anyDim = true;
  }
  attr.needsUpdate = true;
  if (!opts?.keepTransparent) {
    const m = mesh.material as Material;
    if (m.transparent !== anyDim) {
      m.transparent = anyDim;
      // three compiles opaque programs with an OPAQUE define that FORCES
      // diffuseColor.a = 1.0 (opaque_fragment) — flipping `transparent` without
      // a recompile keeps that define, so the alpha multiply is dead. Bump the
      // material version on the flip (rare: enter/exit group) to re-key the
      // program.
      m.needsUpdate = true;
    }
  }
}
