// SketchUp-style drawing inference + snapping (planfile §6), pure and
// unit-testable without WebGL. Given a raw pointer point (a raycast onto the
// ground plane) and a context of existing geometry, resolve it to a snapped
// point plus metadata describing WHAT it snapped to — so the viewport can draw
// the matching inference guide/label.
//
// Priority (highest first): existing node → on-pipe point → axis inference
// from the path's start point → world grid → free. Distances are world metres;
// the interaction layer picks tolerances suited to the current zoom.
import { add, dot, length, scale, sub } from '../geometry/math3';
import type { Vec3 } from '../schema';

export type SnapKind = 'node' | 'axis-x' | 'axis-y' | 'axis-z' | 'on-pipe' | 'grid' | 'free';

export interface SnapNode {
  id: string;
  position: Vec3;
}

export interface SnapSegment {
  a: Vec3;
  b: Vec3;
}

export interface SnapContext {
  /** existing nodes the cursor can land on */
  nodes: SnapNode[];
  /** existing member segments, for on-pipe snapping */
  segments: SnapSegment[];
  /** the path's start point, when drawing — enables axis inference */
  fromNode?: Vec3;
  /** world grid step (m); 0 disables grid snapping */
  gridStepM: number;
  /** radius (m) within which the cursor snaps to a node or on-pipe point */
  pointRadiusM: number;
  /** half-width (m) of the corridor around an axis line that snaps to it */
  axisBandM: number;
}

export interface SnapResult {
  position: Vec3;
  kind: SnapKind;
  /** set when kind === 'node' */
  nodeId?: string;
  /** inference guide to draw (axis line through the start point) */
  guide?: { axis: 'x' | 'y' | 'z'; from: Vec3; to: Vec3 };
}

const AXES: Array<{ key: 'x' | 'y' | 'z'; dir: Vec3 }> = [
  { key: 'x', dir: { x: 1, y: 0, z: 0 } },
  { key: 'y', dir: { x: 0, y: 1, z: 0 } },
  { key: 'z', dir: { x: 0, y: 0, z: 1 } },
];

function roundTo(v: number, step: number): number {
  return step > 0 ? Math.round(v / step) * step : v;
}

function snapToGrid(p: Vec3, step: number): Vec3 {
  return { x: roundTo(p.x, step), y: roundTo(p.y, step), z: roundTo(p.z, step) };
}

/** Closest point to `p` on the segment a→b (clamped to the endpoints). */
export function closestPointOnSegment(p: Vec3, a: Vec3, b: Vec3): Vec3 {
  const ab = sub(b, a);
  const len2 = dot(ab, ab);
  if (len2 < 1e-18) return a;
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / len2));
  return add(a, scale(ab, t));
}

/** Resolve a raw pointer point to a snapped drawing point. */
export function snapPoint(raw: Vec3, ctx: SnapContext): SnapResult {
  // 1. existing node
  let best: { d: number; node: SnapNode } | null = null;
  for (const n of ctx.nodes) {
    const d = length(sub(raw, n.position));
    if (d <= ctx.pointRadiusM && (!best || d < best.d)) best = { d, node: n };
  }
  if (best) return { position: best.node.position, kind: 'node', nodeId: best.node.id };

  // 2. on-pipe point
  let onPipe: { d: number; p: Vec3 } | null = null;
  for (const s of ctx.segments) {
    const cp = closestPointOnSegment(raw, s.a, s.b);
    const d = length(sub(raw, cp));
    if (d <= ctx.pointRadiusM && (!onPipe || d < onPipe.d)) onPipe = { d, p: cp };
  }
  if (onPipe) return { position: onPipe.p, kind: 'on-pipe' };

  // 3. axis inference from the path start: project onto whichever world axis
  //    line (through fromNode) the cursor is closest to, if within the band.
  if (ctx.fromNode) {
    const from = ctx.fromNode;
    const rel = sub(raw, from);
    let bestAxis: { key: 'x' | 'y' | 'z'; dir: Vec3; perp: number; t: number } | null = null;
    for (const ax of AXES) {
      const t = dot(rel, ax.dir); // signed distance along the axis
      const along = scale(ax.dir, t);
      const perp = length(sub(rel, along));
      if (perp <= ctx.axisBandM && (!bestAxis || perp < bestAxis.perp)) {
        bestAxis = { key: ax.key, dir: ax.dir, perp, t };
      }
    }
    if (bestAxis) {
      const t = roundTo(bestAxis.t, ctx.gridStepM); // grid-quantize length along the axis
      const position = add(from, scale(bestAxis.dir, t));
      return {
        position,
        kind: `axis-${bestAxis.key}` as SnapKind,
        guide: { axis: bestAxis.key, from, to: position },
      };
    }
  }

  // 4. world grid
  if (ctx.gridStepM > 0) return { position: snapToGrid(raw, ctx.gridStepM), kind: 'grid' };

  // 5. free
  return { position: raw, kind: 'free' };
}

/** Default tolerances for a design working at furniture/rig scale. */
export function defaultSnapTolerances(): Pick<
  SnapContext,
  'gridStepM' | 'pointRadiusM' | 'axisBandM'
> {
  return {
    gridStepM: 0.0254, // 1 inch
    pointRadiusM: 0.02,
    axisBandM: 0.03,
  };
}
