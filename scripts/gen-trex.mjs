// One-off generator: a low-poly T-rex STL → two PVC Builder examples whose edges
// are straight pipes and whose vertices are nodes (a wireframe, no decimation).
//
// The STL is triangulated; a raw triangle wireframe is busy (every quad face
// carries its diagonal). We convert TRIS → QUADS: greedily pair each triangle
// with a neighbour across a shared edge (preferring the most coplanar pairing)
// and DROP that shared edge — so quad faces read as quads, not crossed tris.
// Vertices are preserved (no vertex welding beyond de-duplicating identical
// coordinates), so the model keeps its shape.
//
// Run:  node scripts/gen-trex.mjs ~/Downloads/trexfinalfrfr.stl
// Emits src/examples/trex-rigid.json (schema 1, no joints — exercises the
// migration chain) and src/examples/trex-pivots.json (schema 6, a FREE ball hub
// at every node: one receiver + a free joint per other incident pipe).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const path = process.argv[2];
if (!path) throw new Error('usage: node scripts/gen-trex.mjs <file.stl>');
const buf = readFileSync(path);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const triCount = dv.getUint32(80, true);

const tris = [];
let off = 84;
for (let i = 0; i < triCount; i++) {
  off += 12; // skip normal
  const t = [];
  for (let v = 0; v < 3; v++) {
    t.push([dv.getFloat32(off, true), dv.getFloat32(off + 4, true), dv.getFloat32(off + 8, true)]);
    off += 12;
  }
  off += 2;
  tris.push(t);
}

// STL is Z-up (height=z, length=x, width=y); the app is Y-up on the XZ ground.
// Remap so the model stands: app = (x, z, y).
const remap = (p) => [p[0], p[2], p[1]];

// de-duplicate identical vertices (STL repeats them per triangle). This is NOT
// decimation — the tolerance is tiny, it only merges coincident coordinates.
let min = [Infinity, Infinity, Infinity];
let max = [-Infinity, -Infinity, -Infinity];
for (const t of tris)
  for (const p of t)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[k]);
      max[k] = Math.max(max[k], p[k]);
    }
const diag = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
const q = diag * 1e-5;
const keyOf = (p) => `${Math.round(p[0] / q)},${Math.round(p[1] / q)},${Math.round(p[2] / q)}`;
const idByKey = new Map();
const positions = [];
const idOf = (p) => {
  const k = keyOf(p);
  let id = idByKey.get(k);
  if (id === undefined) {
    id = positions.length;
    idByKey.set(k, id);
    positions.push(remap(p));
  }
  return id;
};
const triIds = tris.map(([a, b, c]) => [idOf(a), idOf(b), idOf(c)]);

// per-triangle unit normal (app space) for the coplanarity score
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm3 = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const triNormal = (t) => {
  const [a, b, c] = t.map((id) => positions[id]);
  return norm3(cross3(sub3(b, a), sub3(c, a)));
};
const normals = triIds.map(triNormal);

const ek = (u, v) => (u < v ? `${u}-${v}` : `${v}-${u}`);
// map each edge → the triangles that use it
const edgeTris = new Map();
triIds.forEach((t, ti) => {
  for (const [u, v] of [
    [t[0], t[1]],
    [t[1], t[2]],
    [t[2], t[0]],
  ]) {
    if (u === v) continue;
    const k = ek(u, v);
    const l = edgeTris.get(k);
    if (l) l.push(ti);
    else edgeTris.set(k, [ti]);
  }
});

// TRIS → QUADS: greedy matching. Candidate pair = an edge shared by exactly two
// triangles; score = coplanarity (dot of the two normals, higher = flatter). Pair
// each triangle at most once, dropping the shared (diagonal) edge.
const candidates = [];
for (const [k, ts] of edgeTris) {
  if (ts.length !== 2) continue; // boundary / non-manifold edges are kept
  const [t1, t2] = ts;
  const score =
    normals[t1][0] * normals[t2][0] +
    normals[t1][1] * normals[t2][1] +
    normals[t1][2] * normals[t2][2];
  candidates.push({ edge: k, t1, t2, score });
}
candidates.sort((a, b) => b.score - a.score);
const paired = new Set();
const dropped = new Set();
for (const c of candidates) {
  if (paired.has(c.t1) || paired.has(c.t2)) continue;
  paired.add(c.t1);
  paired.add(c.t2);
  dropped.add(c.edge);
}

const edges = [...edgeTris.keys()].filter((k) => !dropped.has(k));

// normalize in app space: centre X/Z, rest on the ground (minY = 0), scale so
// the longest dimension ≈ TARGET_M
const TARGET_M = 1.8;
let amin = [Infinity, Infinity, Infinity];
let amax = [-Infinity, -Infinity, -Infinity];
for (const p of positions)
  for (let k = 0; k < 3; k++) {
    amin[k] = Math.min(amin[k], p[k]);
    amax[k] = Math.max(amax[k], p[k]);
  }
const span = [amax[0] - amin[0], amax[1] - amin[1], amax[2] - amin[2]];
const scale = TARGET_M / Math.max(...span);
const cx = (amin[0] + amax[0]) / 2;
const cz = (amin[2] + amax[2]) / 2;
const round = (n) => Math.round(n * 1e6) / 1e6;
const nodes = positions.map((p, i) => ({
  id: `n${i}`,
  position: {
    x: round((p[0] - cx) * scale),
    y: round((p[1] - amin[1]) * scale),
    z: round((p[2] - cz) * scale),
  },
}));
const rawMembers = edges.map((e, i) => {
  const [u, v] = e.split('-');
  return { id: `m${i}`, kind: 'straight', nodeA: `n${u}`, nodeB: `n${v}`, size: '1/2"' };
});

// ── PRUNE substantially-overlapping pipes. The tris→quads wireframe leaves some
// edges that lie almost on top of a longer edge (a vertex sitting on another
// edge, near-collinear duplicates) — they render as two pipes fused into one.
// Drop the SHORTER of any near-collinear pair whose shorter member is mostly
// buried along the longer (within ~one OD perpendicular, ≥ OVERLAP_FRAC covered).
const PERP_TOL = 0.012; // metres (~one 1/2" OD): lines closer than this are "the same line"
const OVERLAP_FRAC = 0.5; // ≥50% of the shorter buried in the longer → overlap
const dsub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const ddot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const dlen = (a) => Math.hypot(a.x, a.y, a.z);
const rawPosOf = (nid) => nodes[Number(nid.slice(1))].position;
const rawLen = (m) => dlen(dsub(rawPosOf(m.nodeA), rawPosOf(m.nodeB)));
/** does segment j (b1→b2) overlap segment i (a1→a2) substantially? (i is longer) */
function overlapsSubstantially(a1, a2, b1, b2) {
  const di = dsub(a2, a1);
  const Li = dlen(di);
  if (Li < 1e-6) return false;
  const u = { x: di.x / Li, y: di.y / Li, z: di.z / Li };
  const along = (p) => {
    const w = dsub(p, a1);
    const t = ddot(w, u);
    const proj = { x: a1.x + u.x * t, y: a1.y + u.y * t, z: a1.z + u.z * t };
    return { t, perp: dlen(dsub(p, proj)) };
  };
  const p1 = along(b1);
  const p2 = along(b2);
  if (p1.perp > PERP_TOL || p2.perp > PERP_TOL) return false; // not collinear + close
  const lo = Math.max(0, Math.min(p1.t, p2.t));
  const hi = Math.min(Li, Math.max(p1.t, p2.t));
  const overlap = Math.max(0, hi - lo);
  const Lj = Math.abs(p1.t - p2.t); // projected length of j
  return Lj > 1e-6 && overlap / Lj >= OVERLAP_FRAC;
}
// keep longest first; a member is dropped if it overlaps one already kept
const kept = [];
for (const m of [...rawMembers].sort((a, b) => rawLen(b) - rawLen(a))) {
  const a1 = rawPosOf(m.nodeA);
  const a2 = rawPosOf(m.nodeB);
  const overlapping = kept.some((k) =>
    overlapsSubstantially(rawPosOf(k.nodeA), rawPosOf(k.nodeB), a1, a2),
  );
  if (!overlapping) kept.push(m);
}
const prunedCount = rawMembers.length - kept.length;

// re-index nodes (drop those left orphaned by pruning) + members
const usedNodeIds = new Set();
for (const m of kept) {
  usedNodeIds.add(m.nodeA);
  usedNodeIds.add(m.nodeB);
}
const nodeIdMap = new Map();
const finalNodes = [];
for (const n of nodes) {
  if (!usedNodeIds.has(n.id)) continue;
  const id = `n${finalNodes.length}`;
  nodeIdMap.set(n.id, id);
  finalNodes.push({ id, position: n.position });
}
const members = kept.map((m, i) => ({
  id: `m${i}`,
  kind: 'straight',
  nodeA: nodeIdMap.get(m.nodeA),
  nodeB: nodeIdMap.get(m.nodeB),
  size: '1/2"',
}));

// pipe length in app space, for picking the longest incident pipe as a hub's
// common receiver
const posOf = (nid) => finalNodes[Number(nid.slice(1))].position;
const lenOf = (m) => {
  const a = posOf(m.nodeA);
  const b = posOf(m.nodeB);
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
};

// incident members per node, and each hub's common receiver (its longest pipe)
const incident = new Map(); // nodeId → memberIds
for (const m of members)
  for (const n of [m.nodeA, m.nodeB]) {
    const l = incident.get(n);
    if (l) l.push(m.id);
    else incident.set(n, [m.id]);
  }
const receiverOf = (memberIds) =>
  [...memberIds].sort((a, b) => lenOf(members[Number(b.slice(1))]) - lenOf(members[Number(a.slice(1))]))[0];

// FREE ball hub at every node: every OTHER incident pipe gets a free joint to the
// receiver (see makeFreeHub / DECISIONS).
const freeJoints = [];
let jc = 0;
for (const [nodeId, memberIds] of incident) {
  if (memberIds.length < 2) continue;
  const receiver = receiverOf(memberIds);
  for (const mover of memberIds)
    if (mover !== receiver)
      freeJoints.push({ id: `jt${jc++}`, nodeId, receiver, mover, onBody: false, mode: 'free' });
}

// RANDOM non-pinned WRAPPED connectors: a seeded coin-flip per non-receiver
// incident pipe decides whether it's a wrapped pivot (swivels about the receiver,
// NOT pinned) or left rigid (no joint = welded). Seeded PRNG → reproducible bake.
const mulberry32 = (seed) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const WRAP_PROB = 0.5;
const wrappedJoints = [];
let wc = 0;
const rng = mulberry32(0x7be51ce5);
for (const [nodeId, memberIds] of incident) {
  if (memberIds.length < 2) continue;
  const receiver = receiverOf(memberIds);
  for (const mover of memberIds) {
    if (mover === receiver) continue;
    if (rng() < WRAP_PROB)
      wrappedJoints.push({ id: `jt${wc++}`, nodeId, receiver, mover, onBody: false, mode: 'wrapped' });
  }
}

const base = {
  unitsPreference: 'metric',
  enabledSizes: ['1/2"'],
  lengthsLocked: false,
  nodes: finalNodes,
  members,
};

// rigid: schema 1 (no joints) — runs the migration chain on load
const rigid = { schemaVersion: 1, id: 'trex-rigid', name: 'T-rex (rigid)', ...base };
// pivots: schema 6 with a free hub at every node
const pivots = {
  schemaVersion: 6,
  id: 'trex-pivots',
  name: 'T-rex (universal pivots)',
  ...base,
  joints: freeJoints,
  measurements: [],
};
// wrapped: schema 6 with a random subset of connections as wrapped (swivel) pivots
const wrapped = {
  schemaVersion: 6,
  id: 'trex-wrapped',
  name: 'T-rex (random wrapped)',
  ...base,
  joints: wrappedJoints,
  measurements: [],
};

const write = (name, design) => {
  const out = fileURLToPath(new URL(`../src/examples/${name}.json`, import.meta.url));
  writeFileSync(out, JSON.stringify(design));
};
write('trex-rigid', rigid);
write('trex-pivots', pivots);
write('trex-wrapped', wrapped);
console.log(
  `tris ${tris.length} → verts ${finalNodes.length}, members ${members.length} ` +
    `(dropped ${dropped.size} tri diagonals, pruned ${prunedCount} overlapping), ` +
    `free joints ${freeJoints.length}, wrapped joints ${wrappedJoints.length}`,
);
console.log('app-space span (m):', span.map((s) => round(s * scale)));
