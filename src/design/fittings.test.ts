import { describe, expect, it } from 'vitest';
import { scale } from '../geometry/math3';
import { createEmptyDesign, type Design, type NominalSize, type Vec3 } from '../schema';
import { appendPipe, startPath } from './docOps';
import { resolveFittings } from './fittings';

const V = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** A star of pipes emanating from a centre node 'c' in the given unit
 * directions — the incident end at 'c' points along each `dir`. */
function star(ends: Array<{ dir: Vec3; size: NominalSize }>): Design {
  const d = createEmptyDesign('d', 'star');
  d.nodes.push({ id: 'c', position: V(0, 0, 0) });
  ends.forEach((e, i) => {
    d.nodes.push({ id: `o${i}`, position: scale(e.dir, 1) });
    d.members.push({ id: `m${i}`, kind: 'straight', nodeA: 'c', nodeB: `o${i}`, size: e.size });
  });
  return d;
}

const fittingAt = (d: Design, id = 'c') => resolveFittings(d).fittings.find((f) => f.nodeId === id);
const conflictAt = (d: Design, id = 'c') =>
  resolveFittings(d).conflicts.find((c) => c.nodeId === id);

const X = V(1, 0, 0);
const NX = V(-1, 0, 0);
const Y = V(0, 1, 0);
const Z = V(0, 0, 1);
const NZ = V(0, 0, -1);
const S = 1 / Math.SQRT2;

describe('resolveFittings — 2-way joints', () => {
  it('collinear, same size → coupling', () => {
    const f = fittingAt(
      star([
        { dir: X, size: '1/2"' },
        { dir: NX, size: '1/2"' },
      ]),
    );
    expect(f?.type).toBe('coupling');
    expect(f?.reducing).toBe(false);
  });

  it('collinear, different size → reducer', () => {
    const f = fittingAt(
      star([
        { dir: X, size: '1/2"' },
        { dir: NX, size: '3/4"' },
      ]),
    );
    expect(f?.type).toBe('reducer');
    expect(f?.reducing).toBe(true);
  });

  it('~90° → 90° elbow', () => {
    const f = fittingAt(
      star([
        { dir: X, size: '3/4"' },
        { dir: Z, size: '3/4"' },
      ]),
    );
    expect(f?.type).toBe('elbow90');
  });

  it('~45° (dirs 135° apart) → 45° elbow', () => {
    const f = fittingAt(
      star([
        { dir: X, size: '3/4"' },
        { dir: V(-S, 0, S), size: '3/4"' },
      ]),
    );
    expect(f?.type).toBe('elbow45');
  });

  it('non-standard angle → conflict', () => {
    const c = conflictAt(
      star([
        { dir: X, size: '3/4"' },
        { dir: V(0.5, 0, 0.866), size: '3/4"' },
      ]),
    );
    expect(c?.reason).toMatch(/non-standard angle/);
  });

  it('elbow with mixed sizes → conflict (no standard reducing elbow)', () => {
    const c = conflictAt(
      star([
        { dir: X, size: '1/2"' },
        { dir: Z, size: '3/4"' },
      ]),
    );
    expect(c?.reason).toMatch(/reducing elbow/);
  });
});

describe('resolveFittings — tees', () => {
  it('two collinear + perpendicular branch → tee', () => {
    const f = fittingAt(
      star([
        { dir: X, size: '3/4"' },
        { dir: NX, size: '3/4"' },
        { dir: Z, size: '3/4"' },
      ]),
    );
    expect(f?.type).toBe('tee');
    expect(f?.reducing).toBe(false);
  });

  it('reducing branch → reducing tee', () => {
    const f = fittingAt(
      star([
        { dir: X, size: '3/4"' },
        { dir: NX, size: '3/4"' },
        { dir: Z, size: '1/2"' },
      ]),
    );
    expect(f?.type).toBe('tee');
    expect(f?.reducing).toBe(true);
  });

  it('run mixes sizes → conflict', () => {
    const c = conflictAt(
      star([
        { dir: X, size: '1/2"' },
        { dir: NX, size: '3/4"' },
        { dir: Z, size: '1/2"' },
      ]),
    );
    expect(c?.reason).toMatch(/run mixes sizes/);
  });

  it('branch not perpendicular → conflict', () => {
    const c = conflictAt(
      star([
        { dir: X, size: '3/4"' },
        { dir: NX, size: '3/4"' },
        { dir: V(0.5, 0, 0.866), size: '3/4"' },
      ]),
    );
    expect(c?.reason).toMatch(/not perpendicular/);
  });

  it('three pipes with no straight run → conflict', () => {
    const c = conflictAt(
      star([
        { dir: X, size: '3/4"' },
        { dir: V(-0.5, 0, 0.866), size: '3/4"' },
        { dir: V(-0.5, 0, -0.866), size: '3/4"' },
      ]),
    );
    expect(c?.reason).toMatch(/no straight run/);
  });

  it('three mutually perpendicular pipes → 3-way corner elbow', () => {
    const f = fittingAt(
      star([
        { dir: X, size: '3/4"' },
        { dir: Y, size: '3/4"' },
        { dir: Z, size: '3/4"' },
      ]),
    );
    expect(f?.type).toBe('elbow3way');
    expect(f?.reducing).toBe(false);
  });

  it('3-way corner mixing sizes → reducing 3-way elbow', () => {
    const f = fittingAt(
      star([
        { dir: X, size: '3/4"' },
        { dir: Y, size: '1/2"' },
        { dir: Z, size: '3/4"' },
      ]),
    );
    expect(f?.type).toBe('elbow3way');
    expect(f?.reducing).toBe(true);
  });
});

describe('resolveFittings — crosses & overloaded joints', () => {
  it('two perpendicular runs → cross', () => {
    const f = fittingAt(
      star([
        { dir: X, size: '1/2"' },
        { dir: NX, size: '1/2"' },
        { dir: Z, size: '1/2"' },
        { dir: NZ, size: '1/2"' },
      ]),
    );
    expect(f?.type).toBe('cross');
    expect(f?.reducing).toBe(false);
  });

  it('mixed sizes → reducing cross', () => {
    const f = fittingAt(
      star([
        { dir: X, size: '3/4"' },
        { dir: NX, size: '3/4"' },
        { dir: Z, size: '1/2"' },
        { dir: NZ, size: '1/2"' },
      ]),
    );
    expect(f?.reducing).toBe(true);
  });

  it('four pipes not forming two runs → conflict', () => {
    const c = conflictAt(
      star([
        { dir: X, size: '1/2"' },
        { dir: NX, size: '1/2"' },
        { dir: Z, size: '1/2"' },
        { dir: V(0.5, 0, 0.866), size: '1/2"' },
      ]),
    );
    expect(c).toBeDefined();
  });

  it('five pipes → conflict', () => {
    const c = conflictAt(
      star([
        { dir: X, size: '1/2"' },
        { dir: NX, size: '1/2"' },
        { dir: Z, size: '1/2"' },
        { dir: NZ, size: '1/2"' },
        { dir: V(0, 1, 0), size: '1/2"' },
      ]),
    );
    expect(c?.reason).toMatch(/5 pipes/);
  });
});

describe('resolveFittings — open ends and whole paths', () => {
  it('a single pipe end gets no fitting and no conflict', () => {
    const d = star([{ dir: X, size: '3/4"' }]);
    const r = resolveFittings(d);
    expect(r.fittings.find((f) => f.nodeId === 'c')).toBeUndefined();
    expect(r.conflicts).toHaveLength(0);
  });

  it('an L-path resolves to one 90° elbow, open ends bare', () => {
    let d = createEmptyDesign('d', 'L');
    const s = startPath(d, V(0, 0, 0));
    d = s.design;
    const p1 = appendPipe(d, s.nodeId, V(1, 0, 0), '3/4"');
    d = p1.design;
    const p2 = appendPipe(d, p1.nodeId, V(1, 0, 1), '3/4"');
    d = p2.design;
    const r = resolveFittings(d);
    expect(r.fittings).toHaveLength(1);
    expect(r.fittings[0]!.type).toBe('elbow90');
    expect(r.conflicts).toHaveLength(0);
  });
});
