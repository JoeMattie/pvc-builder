import { type Design, migrateToLatest } from '../schema';
import trexWireframe from './trex-wireframe.json';

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
    id: 'trex-wireframe',
    name: 'T-rex (wireframe)',
    description: '262 nodes · 780 pipes — a low-poly mesh drawn as pipe (no fittings)',
    load: () => migrateToLatest(trexWireframe),
  },
];
