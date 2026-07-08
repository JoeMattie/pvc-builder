// Hand-built example designs (generic subjects only — no creature strings).
import { createEmptyDesign, type Design, type NominalSize, type Vec3 } from '../schema';

const V = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

function build(
  name: string,
  nodes: Array<[string, Vec3]>,
  edges: Array<[string, string]>,
  size: NominalSize,
): Design {
  const d = createEmptyDesign('gen', name);
  d.unitsPreference = 'metric';
  for (const [id, position] of nodes) d.nodes.push({ id, position });
  edges.forEach(([a, b], i) => {
    d.members.push({ id: `m${i}`, kind: 'straight', nodeA: a, nodeB: b, size });
  });
  return d;
}

/** A 1 m open cube frame — 8 corners, 12 edges (each corner a 3-way conflict:
 * PVC needs a corner fitting, which is flagged). */
export function cubeFrame(): Design {
  const s = 1;
  const b = [V(0, 0, 0), V(s, 0, 0), V(s, 0, s), V(0, 0, s)];
  const t = b.map((p) => V(p.x, s, p.z));
  const nodes: Array<[string, Vec3]> = [
    ...b.map((p, i) => [`b${i}`, p] as [string, Vec3]),
    ...t.map((p, i) => [`t${i}`, p] as [string, Vec3]),
  ];
  const ring = (pfx: string): Array<[string, string]> =>
    [0, 1, 2, 3].map((i) => [`${pfx}${i}`, `${pfx}${(i + 1) % 4}`] as [string, string]);
  const verticals: Array<[string, string]> = [0, 1, 2, 3].map((i) => [`b${i}`, `t${i}`]);
  return build('Cube frame', nodes, [...ring('b'), ...ring('t'), ...verticals], '3/4"');
}

/** A serial articulated arm — three 0.6 m links, each WRAPPED around the previous
 * so it swivels about that pipe (a heat-wrap swivel). A zig-zag rest pose keeps
 * each link perpendicular to the one it wraps, so the joints actually move.
 * Toggle "Lengths" and drag / use the sliders to pose it. */
export function articulatedArm(): Design {
  const d = build(
    'Articulated arm',
    [
      ['n0', V(0, 0, 0)],
      ['n1', V(0.6, 0, 0)],
      ['n2', V(0.6, 0, 0.6)],
      ['n3', V(0.6, 0.6, 0.6)],
    ],
    [
      ['n0', 'n1'],
      ['n1', 'n2'],
      ['n2', 'n3'],
    ],
    '3/4"',
  );
  d.joints.push(
    {
      id: 'jt0',
      nodeId: 'n1',
      receiver: 'm0',
      mover: 'm1',
      onBody: false,
      mode: 'wrapped',
      angleRad: 0,
    },
    {
      id: 'jt1',
      nodeId: 'n2',
      receiver: 'm1',
      mover: 'm2',
      onBody: false,
      mode: 'wrapped',
      angleRad: 0,
    },
  );
  return d;
}
