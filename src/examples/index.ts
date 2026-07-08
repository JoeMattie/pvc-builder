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
    description: '57 nodes · 145 pipes — decimated low-poly mesh, all joints rigid',
    load: () => migrateToLatest(trexRigid),
  },
  {
    id: 'trex-pivots',
    name: 'T-rex (universal pivots)',
    description: '145 pipes · 233 free ball joints — every intersection is a universal pivot',
    load: () => migrateToLatest(trexPivots),
  },
];
