import { type Design, migrateToLatest } from '../schema';
import { articulatedArm, cubeFrame } from './generators';
import raptorTail from './raptor-tail.json';
import raptorTorso from './raptor-torso.json';
import trexPivots from './trex-pivots.json';
import trexRigid from './trex-rigid.json';
import trexWrapped from './trex-wrapped.json';

// Bundled example designs, offered from the project list for a fast look
// (planfile §7). Generic subjects only. Each `load()` runs the baked JSON
// through migrateToLatest so it is validated + upgraded like any imported file.
export interface Example {
  id: string;
  name: string;
  description: string;
  load(): Design;
}

export const EXAMPLES: Example[] = [
  {
    id: 'articulated-arm',
    name: 'Articulated arm',
    description: '3 links + 2 pivots — lock lengths and pose it',
    load: () => articulatedArm(),
  },
  {
    id: 'cube-frame',
    name: 'Cube frame',
    description: '1 m open cube — 12 pipes, corner conflicts flagged',
    load: () => cubeFrame(),
  },
  {
    id: 'raptor-torso',
    name: 'Raptor · harness frame',
    description:
      'Phase 1 — hip/shoulder PVC frame that hangs on the mannequin (turn it on in Play)',
    load: () => migrateToLatest(raptorTorso),
  },
  {
    id: 'raptor-tail',
    name: 'Raptor · + tail',
    description:
      'Phase 2 — adds a segmented counterweight tail with wrapped flex joints + elastics',
    load: () => migrateToLatest(raptorTail),
  },
  {
    id: 'trex-rigid',
    name: 'T-rex (rigid)',
    description: '262 nodes · 520 pipes — low-poly mesh, tris→quads, all joints rigid',
    load: () => migrateToLatest(trexRigid),
  },
  {
    id: 'trex-pivots',
    name: 'T-rex (universal pivots)',
    description: '520 pipes — a free ball hub at every one of the 262 nodes',
    load: () => migrateToLatest(trexPivots),
  },
  {
    id: 'trex-wrapped',
    name: 'T-rex (random wrapped)',
    description: '520 pipes — a random mix of wrapped (swivel) pivots and rigid joints',
    load: () => migrateToLatest(trexWrapped),
  },
];
