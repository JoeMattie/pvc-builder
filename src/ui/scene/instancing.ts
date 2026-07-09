// Matrix builders for InstancedMesh rendering. Each primitive is drawn from a
// UNIT base geometry (radius/height 1) and placed per-instance by composing a
// transform into the instance matrix — so one draw call covers thousands of
// pipes/joint parts, and the transforms are updated imperatively each frame
// (from the eased render positions) without re-rendering React. See PipeLayer
// and InstancedFreeHubs. Module-scoped scratch objects avoid per-instance
// allocation in the per-frame loop.
import { Matrix4, Quaternion, Vector3 } from 'three';
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
 * toward the branch `er`, Y = receiver axis `u`, Z = the swing dir cross(u,er))
 * into the world at `node`, uniformly scaled by `s`. Uses `makeBasis` (not
 * `compose`) so the loop's left-handed local frame is preserved. `localPre`, if
 * given, is right-multiplied — for a primitive (e.g. the arrowhead) baked at a
 * fixed offset inside that frame. */
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
  _ez.crossVectors(_ey, _ex); // swing direction = cross(u, er)
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
