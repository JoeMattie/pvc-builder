// Phase 2 — Project Raptor torso + tail (the rear counterweight).
// Emits src/examples/raptor-tail.json (schemaVersion 9). Run:
//   node scripts/gen-raptor-tail.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildTail, buildTorso, Raptor } from './raptor-lib.mjs';

const R = new Raptor();
buildTail(R, buildTorso(R));
const design = R.toDesign('raptor-tail', 'Raptor 2 · + tail', 2.5);

const out = fileURLToPath(new URL('../src/examples/raptor-tail.json', import.meta.url));
writeFileSync(out, JSON.stringify(design));
console.log(
  `raptor-tail: ${design.nodes.length} nodes, ${design.members.length} members, ` +
    `${design.joints.length} joints, ${design.elastics.length} elastics`,
);
