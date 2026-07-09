// Phase 3 — Project Raptor torso + tail + decorative legs.
// Emits src/examples/raptor-legs.json (schemaVersion 9). Run:
//   node scripts/gen-raptor-legs.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildLegs, buildTail, buildTorso, Raptor } from './raptor-lib.mjs';

const R = new Raptor();
buildLegs(R, buildTail(R, buildTorso(R)));
const design = R.toDesign('raptor-legs', 'Raptor 3 · + legs', 2.5);

const out = fileURLToPath(new URL('../src/examples/raptor-legs.json', import.meta.url));
writeFileSync(out, JSON.stringify(design));
console.log(
  `raptor-legs: ${design.nodes.length} nodes, ${design.members.length} members, ` +
    `${design.joints.length} joints, ${design.elastics.length} elastics`,
);
