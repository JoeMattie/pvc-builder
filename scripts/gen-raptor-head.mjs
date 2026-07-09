// Phase 5 — the FULL Project Raptor: torso + tail + legs + neck + head/jaw.
// Emits src/examples/raptor-head.json (schemaVersion 9). Run:
//   node scripts/gen-raptor-head.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildHead,
  buildLegs,
  buildNeck,
  buildTail,
  buildTorso,
  Raptor,
} from './raptor-lib.mjs';

const R = new Raptor();
buildHead(R, buildNeck(R, buildLegs(R, buildTail(R, buildTorso(R)))));
const design = R.toDesign('raptor-head', 'Raptor 5 · full costume', 2.5);

const out = fileURLToPath(new URL('../src/examples/raptor-head.json', import.meta.url));
writeFileSync(out, JSON.stringify(design));
console.log(
  `raptor-head: ${design.nodes.length} nodes, ${design.members.length} members, ` +
    `${design.joints.length} joints, ${design.elastics.length} elastics`,
);
