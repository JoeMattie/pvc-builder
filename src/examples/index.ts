import { type Design, migrateToLatest } from '../schema';
import { articulatedArm, cubeFrame } from './generators';
import trexPivots from './trex-pivots.json';
import trexRigid from './trex-rigid.json';

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
    id: 'trex-rigid',
    name: 'T-rex (rigid)',
    description: '262 nodes · 541 pipes — low-poly mesh, tris→quads, all joints rigid',
    load: () => migrateToLatest(trexRigid),
  },
  {
    id: 'trex-pivots',
    name: 'T-rex (universal pivots)',
    description: '541 pipes — a free ball hub at every one of the 262 nodes',
    load: () => migrateToLatest(trexPivots),
  },
];
