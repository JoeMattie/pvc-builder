// Pure screen-space hit-testing for the rubber-band (marquee) selection
// (planfile §1). The scene projects each member to a screen polyline; these
// helpers decide whether it is selected under CAD/SketchUp semantics:
//   • drag left→right  = WINDOW   → select members fully CONTAINED in the rect
//   • drag right→left  = CROSSING → select members that TOUCH the rect
// No three/UI types — the caller does the world→screen projection.

export interface Pt {
  x: number;
  y: number;
}

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Whether the drag went left→right (window/contained) or right→left (crossing). */
export type MarqueeMode = 'window' | 'crossing';

/** Rectangle + mode from the drag's start/end screen points. */
export function marqueeFromDrag(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): {
  rect: Rect;
  mode: MarqueeMode;
} {
  return {
    rect: {
      minX: Math.min(x0, x1),
      minY: Math.min(y0, y1),
      maxX: Math.max(x0, x1),
      maxY: Math.max(y0, y1),
    },
    mode: x1 >= x0 ? 'window' : 'crossing',
  };
}

export function pointInRect(p: Pt, r: Rect): boolean {
  return p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;
}

/** Closest point to `p` on the 2D segment a→b: the clamped parameter `t`
 * (0 at a, 1 at b) and the pixel distance. Used for screen-space snapping of the
 * draw cursor / a dragged endpoint onto a pipe's projected line. */
export function closestOnSegment2D(p: Pt, a: Pt, b: Pt): { t: number; dist: number } {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  const t =
    len2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
  const cx = a.x + abx * t;
  const cy = a.y + aby * t;
  return { t, dist: Math.hypot(p.x - cx, p.y - cy) };
}

/** Orientation sign of the triple (a, b, c). */
function cross3(a: Pt, b: Pt, c: Pt): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** Whether segments p1→p2 and p3→p4 properly intersect (incl. touching). */
export function segmentsIntersect(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d1 = cross3(p3, p4, p1);
  const d2 = cross3(p3, p4, p2);
  const d3 = cross3(p1, p2, p3);
  const d4 = cross3(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  // collinear-touch cases are rare on screen; the endpoint-in-rect test covers them
  return false;
}

/** Whether the polyline crosses any of the rectangle's four edges. */
function polylineCrossesRectEdges(pts: Pt[], r: Rect): boolean {
  const c: Pt[] = [
    { x: r.minX, y: r.minY },
    { x: r.maxX, y: r.minY },
    { x: r.maxX, y: r.maxY },
    { x: r.minX, y: r.maxY },
  ];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    for (let e = 0; e < 4; e++) {
      if (segmentsIntersect(a, b, c[e]!, c[(e + 1) % 4]!)) return true;
    }
  }
  return false;
}

/** Whether a member (its screen polyline) is selected by the marquee. */
export function memberSelectedBy(pts: Pt[], rect: Rect, mode: MarqueeMode): boolean {
  if (pts.length === 0) return false;
  if (mode === 'window') {
    // fully contained: every projected point inside the rect
    return pts.every((p) => pointInRect(p, rect));
  }
  // crossing: any point inside, or any segment crosses a rect edge
  return pts.some((p) => pointInRect(p, rect)) || polylineCrossesRectEdges(pts, rect);
}
