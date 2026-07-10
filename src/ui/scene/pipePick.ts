// Screen-space snap picking: what pipe / node is the cursor visually hovering?
// The draw tool and the endpoint drag both need this, and a 3D ray-distance test
// is WRONG — it snaps to any pipe the ray grazes in depth (a pipe between the
// camera and the cursor's target), so the snap fires "beyond" the pipe on screen.
// Instead we project each segment/node to the SCREEN and measure the cursor's
// pixel distance to it — stable, and only fires when the cursor is over the pipe.
import type { Camera } from 'three';
import { Vector3 } from 'three';
import { nodeById } from '../../design/docOps';
import { closestOnSegment2D, type Pt } from '../../design/marquee';
import type { Design, Vec3 } from '../../schema';

export interface SnapPick {
  point: Vec3;
  /** 'corner' = a formed pipe's bend control point (a point target like a node,
   * but geometry only — no node id, nothing joins) */
  kind: 'node' | 'corner' | 'pipe';
  /** node id or member id */
  id: string;
  distPx: number;
}

/** Cursor-to-pipe/node screen distance (px) that snaps the draw point / a
 * dragged endpoint onto it. */
export const SNAP_PX = 12;

/** Opt-in snap console logging: set `__pvc.snapDebug = true` in the devtools. */
export function snapDebug(): boolean {
  return !!(window as unknown as { __pvc?: { snapDebug?: boolean } }).__pvc?.snapDebug;
}

const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});

/** The nearest snappable target (an existing NODE first, else a point along a
 * straight PIPE) under the cursor `(cx, cy)` client px, within `tolPx`. Nodes and
 * members incident to `excludeNode` are ignored (so a dragged endpoint doesn't
 * snap to itself). Screen-space, so it works at any pipe height and never fires
 * on a pipe the cursor isn't visually over. */
export function pickSnapPoint(
  camera: Camera,
  domElement: HTMLCanvasElement,
  design: Design,
  cx: number,
  cy: number,
  tolPx: number,
  opts?: { excludeNode?: string; nodes?: boolean; pipes?: boolean },
): SnapPick | null {
  const wantNodes = opts?.nodes ?? true;
  const wantPipes = opts?.pipes ?? true;
  const rect = domElement.getBoundingClientRect();
  const camPos = camera.position;
  const fwd = camera.getWorldDirection(new Vector3());
  const scratch = new Vector3();
  const cursor: Pt = { x: cx, y: cy };
  const exclude = opts?.excludeNode;

  // world → client px, or null when the point is behind the camera (projection
  // flips there, giving a garbage screen position)
  const project = (w: Vec3): Pt | null => {
    if ((w.x - camPos.x) * fwd.x + (w.y - camPos.y) * fwd.y + (w.z - camPos.z) * fwd.z <= 0)
      return null;
    scratch.set(w.x, w.y, w.z).project(camera);
    return {
      x: rect.left + (scratch.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-scratch.y * 0.5 + 0.5) * rect.height,
    };
  };

  // 1. nodes take priority (snapping to an existing junction/end)
  let bestNode: { id: string; point: Vec3; distPx: number } | null = null;
  if (wantNodes)
    for (const n of design.nodes) {
      if (n.id === exclude) continue;
      const sp = project(n.position);
      if (!sp) continue;
      const distPx = Math.hypot(sp.x - cx, sp.y - cy);
      if (distPx <= tolPx && (!bestNode || distPx < bestNode.distPx))
        bestNode = { id: n.id, point: n.position, distPx };
    }
  if (bestNode)
    return { point: bestNode.point, kind: 'node', id: bestNode.id, distPx: bestNode.distPx };

  // 1.5 formed pipes' bend CORNERS — point targets like nodes (usually up in the
  // air, where a ground raycast can't reach), toggled with the ends snap
  let bestCorner: { id: string; point: Vec3; distPx: number } | null = null;
  if (wantNodes)
    for (const m of design.members) {
      if (m.kind !== 'formed') continue;
      if (exclude && (m.nodeA === exclude || m.nodeB === exclude)) continue;
      for (const cp of m.controlPoints) {
        const sp = project(cp);
        if (!sp) continue;
        const distPx = Math.hypot(sp.x - cx, sp.y - cy);
        if (distPx <= tolPx && (!bestCorner || distPx < bestCorner.distPx))
          bestCorner = { id: m.id, point: cp, distPx };
      }
    }
  if (bestCorner)
    return {
      point: bestCorner.point,
      kind: 'corner',
      id: bestCorner.id,
      distPx: bestCorner.distPx,
    };

  // 2. a point along a straight pipe (skip members touching the excluded node)
  let bestPipe: { id: string; point: Vec3; distPx: number } | null = null;
  if (wantPipes)
    for (const m of design.members) {
      if (m.kind !== 'straight') continue;
      if (exclude && (m.nodeA === exclude || m.nodeB === exclude)) continue;
      const a = nodeById(design, m.nodeA)?.position;
      const b = nodeById(design, m.nodeB)?.position;
      if (!a || !b) continue;
      const sa = project(a);
      const sb = project(b);
      if (!sa || !sb) continue;
      const { t, dist } = closestOnSegment2D(cursor, sa, sb);
      if (dist <= tolPx && (!bestPipe || dist < bestPipe.distPx))
        bestPipe = { id: m.id, point: lerp3(a, b, t), distPx: dist };
    }
  return bestPipe
    ? { point: bestPipe.point, kind: 'pipe', id: bestPipe.id, distPx: bestPipe.distPx }
    : null;
}
