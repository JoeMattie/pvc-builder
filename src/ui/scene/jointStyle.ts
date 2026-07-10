// Decides how a rigid (anchor) union is drawn: a standard socket TEE when a
// lone on-body branch meets the run at ~90° (a real SCH 40 tee exists), the
// wrap-arrow + pin indicator for another angle, or — when the junction exceeds
// ANY standard fitting (more than 3 pipe ends entering the point, e.g. a
// solved 4-way crossing) — ONE brown fabricated-union sphere for the whole
// cluster. Wrapped pivots always use the wrap indicator. Pure — no three/UI
// types.
import { memberById, nodeById } from '../../design/docOps';
import { dot, length, normalize, sub } from '../../geometry/math3';
import type { Design, Joint } from '../../schema';

// |cos(angle between branch and run)| below this ⇒ within ~8° of perpendicular
const PERP_COS_TOL = 0.14;

/** Pipe ends entering the junction point of `nodeId`: each member ENDING there
 * contributes one end; each distinct straight receiver of an on-body joint at
 * the node passes THROUGH and contributes two. A standard tee is exactly 3. */
export function junctionEndCount(design: Design, nodeId: string): number {
  let ends = 0;
  const incident = new Set<string>();
  for (const m of design.members) {
    if (m.nodeA === nodeId) {
      ends++;
      incident.add(m.id);
    }
    if (m.nodeB === nodeId) {
      ends++;
      incident.add(m.id);
    }
  }
  const through = new Set<string>();
  for (const j of design.joints) {
    if (j.nodeId !== nodeId || !j.onBody) continue;
    if (!incident.has(j.receiver)) through.add(j.receiver);
  }
  return ends + through.size * 2;
}

/** True when the rigid (anchor) cluster at this joint's node is beyond any
 * standard fitting: more than 3 pipe ends entering the point (a solved X /
 * 3-way / 4-way crossing), or an END-TO-END fabricated record (`onBody` false)
 * at a 3-end junction — the "three ends, no straight run" union. Such a
 * junction draws as ONE brown fabricated-union sphere instead of ANY tee /
 * wrap hardware (this predicate gates every anchor render + its hit target). */
export function anchorRendersAsHub(design: Design, joint: Joint): boolean {
  if (joint.mode !== 'anchor') return false;
  const ends = junctionEndCount(design, joint.nodeId);
  return ends > 3 || (!joint.onBody && ends >= 3);
}

/** True when a rigid on-body union is close enough to 90° to be a socket tee.
 * Only a LONE on-body branch qualifies — a tee needs the run passing through
 * and exactly 3 pipe ends at the point; an end-to-end rigid join has no
 * through-run, and a many-way cluster is a fabricated hub (see
 * `anchorRendersAsHub`), never a tee. */
export function anchorRendersAsTee(design: Design, joint: Joint): boolean {
  if (joint.mode !== 'anchor' || !joint.onBody) return false;
  if (junctionEndCount(design, joint.nodeId) > 3) return false;
  const recv = memberById(design, joint.receiver);
  const mover = memberById(design, joint.mover);
  if (recv?.kind !== 'straight' || !mover) return false;
  const a = nodeById(design, recv.nodeA)?.position;
  const b = nodeById(design, recv.nodeB)?.position;
  const node = nodeById(design, joint.nodeId)?.position;
  const farId = mover.nodeA === joint.nodeId ? mover.nodeB : mover.nodeA;
  const far = nodeById(design, farId)?.position;
  if (!a || !b || !node || !far) return false;
  const u = sub(b, a);
  const branch = sub(far, node);
  if (length(u) < 1e-9 || length(branch) < 1e-9) return false;
  return Math.abs(dot(normalize(u), normalize(branch))) < PERP_COS_TOL;
}
