// One-off generator: low-poly T-rex STL → a PVC Builder Design whose edges are
// straight pipes and whose vertices are nodes (a wireframe, no fittings). Run:
//   node scripts/gen-trex.mjs ~/Downloads/trexfinalfrfr.stl
// Emits src/examples/trex-wireframe.json.
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

// weld vertices at a relative tolerance
let min = [Infinity, Infinity, Infinity];
let max = [-Infinity, -Infinity, -Infinity];
for (const t of tris) for (const p of t) for (let k = 0; k < 3; k++) {
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
const edges = new Set();
for (const [a, b, c] of tris) {
  const ia = idOf(a), ib = idOf(b), ic = idOf(c);
  for (const [u, v] of [[ia, ib], [ib, ic], [ic, ia]]) {
    if (u !== v) edges.add(u < v ? `${u}-${v}` : `${v}-${u}`);
  }
}

// normalize in app space: centre X/Z, rest on the ground (minY = 0), scale so
// the longest dimension ≈ TARGET_M
const TARGET_M = 1.8;
let amin = [Infinity, Infinity, Infinity];
let amax = [-Infinity, -Infinity, -Infinity];
for (const p of positions) for (let k = 0; k < 3; k++) {
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
const members = [...edges].map((e, i) => {
  const [u, v] = e.split('-');
  return { id: `m${i}`, kind: 'straight', nodeA: `n${u}`, nodeB: `n${v}`, size: '1/2"' };
});

const design = {
  schemaVersion: 1,
  id: 'trex-wireframe',
  name: 'T-rex (wireframe)',
  unitsPreference: 'metric',
  enabledSizes: ['1/2"', '3/4"'],
  lengthsLocked: false,
  nodes,
  members,
};

const out = fileURLToPath(new URL('../src/examples/trex-wireframe.json', import.meta.url));
writeFileSync(out, JSON.stringify(design));
console.log(`wrote ${out}: ${nodes.length} nodes, ${members.length} members`);
console.log('app-space span (m):', span.map((s) => round(s * scale)));
