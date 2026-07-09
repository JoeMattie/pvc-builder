// Pure geometry for the Extend (push) tool: the set of directions you can push a
// new pipe out of a given end. The 6 world axes plus a "continuation" opposite
// each incident pipe (draw straight through a junction), with any direction that
// would protrude INTO an existing pipe removed. No three.js / UI types.
import { dot, length, normalize, sub } from '../geometry/math3';
import type { Design, NominalSize, Vec3 } from '../schema';
import { incidentMembers, nodeById } from './docOps';

/** The 6 world-axis unit directions. */
const AXES: readonly Vec3[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
];

/** Two unit directions count as "the same" (or a blocking match) when the angle
 * between them is under ~8°. */
const SAME_DIR_COS = Math.cos((8 * Math.PI) / 180);

/** Unit direction each incident member LEAVES `nodeId` — a straight pipe's
 * chord, or a formed pipe's tangent toward its nearest interior point. */
export function incidentDirsAt(design: Design, nodeId: string): Vec3[] {
  const here = nodeById(design, nodeId)?.position;
  if (!here) return [];
  const out: Vec3[] = [];
  for (const m of incidentMembers(design, nodeId)) {
    let toward: Vec3 | undefined;
    if (m.kind === 'straight') {
      const far = m.nodeA === nodeId ? m.nodeB : m.nodeA;
      toward = nodeById(design, far)?.position;
    } else if (m.nodeA === nodeId) {
      toward = m.controlPoints[0] ?? nodeById(design, m.nodeB)?.position;
    } else {
      toward = m.controlPoints[m.controlPoints.length - 1] ?? nodeById(design, m.nodeA)?.position;
    }
    if (!toward) continue;
    const d = sub(toward, here);
    if (length(d) > 1e-9) out.push(normalize(d));
  }
  return out;
}

/** Candidate extend directions from `nodeId`: the 6 world axes PLUS a
 * continuation opposite each incident pipe (draw straight through the junction),
 * with any direction that points ALONG an existing incident pipe removed (a
 * cylinder there would protrude into the pipe). De-duplicated. */
export function extendDirections(design: Design, nodeId: string): Vec3[] {
  const incident = incidentDirsAt(design, nodeId);
  const candidates: Vec3[] = [...AXES, ...incident.map((d) => ({ x: -d.x, y: -d.y, z: -d.z }))];
  const kept: Vec3[] = [];
  for (const c of candidates) {
    // blocked: (nearly) along an existing incident pipe → would protrude into it
    if (incident.some((d) => dot(c, d) > SAME_DIR_COS)) continue;
    // dedupe against directions already kept
    if (kept.some((k) => dot(k, c) > SAME_DIR_COS)) continue;
    kept.push(c);
  }
  return kept;
}

/** The nominal size of the pipe at `nodeId` (the first incident member), for
 * sizing the extend-cylinder gizmos. Null if the node has no incident pipe. */
export function endSizeAt(design: Design, nodeId: string): NominalSize | null {
  return incidentMembers(design, nodeId)[0]?.size ?? null;
}
