// Phase 4 — Project Raptor torso + tail + legs + neck (the front counterweight).
// Emits src/examples/raptor-neck.json (schemaVersion 9). Run:
//   node scripts/gen-raptor-neck.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildLegs, buildNeck, buildTail, buildTorso, Raptor } from './raptor-lib.mjs';

const R = new Raptor();
buildNeck(R, buildLegs(R, buildTail(R, buildTorso(R))));
const design = R.toDesign('raptor-neck', 'Raptor 4 · + neck', 2.5);

const out = fileURLToPath(new URL('../src/examples/raptor-neck.json', import.meta.url));
writeFileSync(out, JSON.stringify(design));
console.log(
  `raptor-neck: ${design.nodes.length} nodes, ${design.members.length} members, ` +
    `${design.joints.length} joints, ${design.elastics.length} elastics`,
);
