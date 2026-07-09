import { describe, expect, it } from 'vitest';
import { createEmptyDesign, type Design, type Vec3 } from '../schema';
import { appendPipe, startPath } from './docOps';
import { endSizeAt, extendDirections, incidentDirsAt } from './extend';

const V = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** Draw a path through points, returning the design + the node ids in order. */
function path(points: Vec3[]) {
  let d: Design = createEmptyDesign('d', 'Ext');
  const s = startPath(d, points[0]!);
  d = s.design;
  const nodeIds = [s.nodeId];
  let from = s.nodeId;
  for (let i = 1; i < points.length; i++) {
    const r = appendPipe(d, from, points[i]!, '3/4"');
    d = r.design;
    from = r.nodeId;
    nodeIds.push(r.nodeId);
  }
  return { design: d, nodeIds };
}

const near = (a: Vec3, b: Vec3): boolean =>
  Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.z - b.z) < 1e-6;
const has = (dirs: Vec3[], d: Vec3): boolean => dirs.some((x) => near(x, d));

describe('extendDirections', () => {
  it('at a free end, offers the 5 world axes except the one INTO the pipe', () => {
    // pipe from origin to (1,0,0); the end node is at (1,0,0) — the pipe leaves
    // that node toward -X, so -X must be blocked (drawing back into the pipe)
    const { design, nodeIds } = path([V(0, 0, 0), V(1, 0, 0)]);
    const endNode = nodeIds[1]!;
    const dirs = extendDirections(design, endNode);
    expect(has(dirs, V(1, 0, 0))).toBe(true); // straight continuation
    expect(has(dirs, V(-1, 0, 0))).toBe(false); // into the pipe → hidden
    expect(has(dirs, V(0, 1, 0))).toBe(true);
    expect(has(dirs, V(0, -1, 0))).toBe(true);
    expect(has(dirs, V(0, 0, 1))).toBe(true);
    expect(has(dirs, V(0, 0, -1))).toBe(true);
    expect(dirs).toHaveLength(5);
  });

  it('at a straight-through junction, hides BOTH colinear axes', () => {
    // two collinear pipes along X meeting at the middle node → the run occupies
    // ±X, so only the 4 perpendicular axes remain
    const { design, nodeIds } = path([V(0, 0, 0), V(1, 0, 0), V(2, 0, 0)]);
    const mid = nodeIds[1]!;
    const dirs = extendDirections(design, mid);
    expect(has(dirs, V(1, 0, 0))).toBe(false);
    expect(has(dirs, V(-1, 0, 0))).toBe(false);
    expect(dirs).toHaveLength(4); // ±Y, ±Z
  });

  it('offers a continuation opposite an OFF-axis incident pipe', () => {
    // a diagonal pipe in the X=... plane so the continuation is not a world axis
    const dir = V(0.6, 0.8, 0); // unit
    const { design, nodeIds } = path([V(0, 0, 0), dir]);
    const endNode = nodeIds[1]!; // pipe leaves this node toward -dir
    const dirs = extendDirections(design, endNode);
    // the straight-through continuation is +dir
    expect(has(dirs, dir)).toBe(true);
    // and the direction back into the pipe (-dir) is absent
    expect(has(dirs, V(-0.6, -0.8, 0))).toBe(false);
  });

  it('incidentDirsAt points away from the node along each pipe', () => {
    const { design, nodeIds } = path([V(0, 0, 0), V(1, 0, 0)]);
    expect(incidentDirsAt(design, nodeIds[0]!)).toEqual([V(1, 0, 0)]); // leaves origin +X
    expect(incidentDirsAt(design, nodeIds[1]!)).toEqual([V(-1, 0, 0)]); // leaves end -X
  });

  it('endSizeAt returns the incident pipe size, null when isolated', () => {
    const { design, nodeIds } = path([V(0, 0, 0), V(1, 0, 0)]);
    expect(endSizeAt(design, nodeIds[0]!)).toBe('3/4"');
    expect(endSizeAt(createEmptyDesign('e', 'x'), 'nope')).toBeNull();
  });
});
