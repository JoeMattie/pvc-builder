// Phase 1 — Project Raptor torso / hip-core harness frame.
// Emits src/examples/raptor-torso.json (schemaVersion 9). Run:
//   node scripts/gen-raptor-torso.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildTorso, Raptor } from './raptor-lib.mjs';

const R = new Raptor();
buildTorso(R);
const design = R.toDesign('raptor-torso', 'Raptor 1 · harness frame', 1.5);

const out = fileURLToPath(new URL('../src/examples/raptor-torso.json', import.meta.url));
writeFileSync(out, JSON.stringify(design));
console.log(
  `raptor-torso: ${design.nodes.length} nodes, ${design.members.length} members, ` +
    `${design.joints.length} joints, ${design.elastics.length} elastics`,
);
