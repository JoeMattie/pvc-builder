// Decides how a rigid (anchor) on-body union is drawn: a standard socket TEE
// when the branch meets the run at ~90° (a real SCH 40 tee exists), or the
// wrap-arrow + pin indicator for any other angle (no off-the-shelf fitting).
// Wrapped pivots always use the wrap indicator. Pure — no three/UI types.
import { memberById, nodeById } from '../../design/docOps';
import { dot, length, normalize, sub } from '../../geometry/math3';
import type { Design, Joint } from '../../schema';

// |cos(angle between branch and run)| below this ⇒ within ~8° of perpendicular
const PERP_COS_TOL = 0.14;

/** True when a rigid on-body union is close enough to 90° to be a socket tee.
 * Only on-body branches qualify — a tee needs the run passing through; an
 * end-to-end rigid join has no through-run (it's an elbow/coupling case). */
export function anchorRendersAsTee(design: Design, joint: Joint): boolean {
  if (joint.mode !== 'anchor' || !joint.onBody) return false;
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
