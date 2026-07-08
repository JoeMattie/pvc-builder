import { create } from 'zustand';
import type { Vec3 } from '../schema';

// Smoothly-eased render positions. Editing writes snapped (stepped) node
// positions into the document; the viewport shows positions that ease toward
// them, so a 1/4" grid — or any snap — glides instead of jumping. Driven once
// per frame by <GeometryAnimator/> (inside the Canvas); PipeLayer and
// SelectionHandles read the eased map and re-render off `v` while it animates.

const eased = new Map<string, Vec3>();

/** bumped each frame the eased positions change; consumers subscribe to force a
 * re-render while animating and stop when settled */
export const useAnim = create<{ v: number }>(() => ({ v: 0 }));

export function easedPos(id: string): Vec3 | undefined {
  return eased.get(id);
}

/** Ease the map one step toward `nodes`. New nodes snap to target (no fly-in);
 * `instant` snaps everything (used for large designs to skip animation).
 * Returns whether anything changed this step. */
export function stepEasing(
  nodes: Array<{ id: string; position: Vec3 }>,
  alpha: number,
  instant: boolean,
): boolean {
  let changed = false;
  const seen = new Set<string>();
  for (const n of nodes) {
    seen.add(n.id);
    const t = n.position;
    const e = eased.get(n.id);
    if (!e) {
      eased.set(n.id, { x: t.x, y: t.y, z: t.z });
      changed = true;
      continue;
    }
    const dx = t.x - e.x;
    const dy = t.y - e.y;
    const dz = t.z - e.z;
    if (dx * dx + dy * dy + dz * dz > 1e-12) {
      if (instant || dx * dx + dy * dy + dz * dz < 1e-8) {
        e.x = t.x;
        e.y = t.y;
        e.z = t.z;
      } else {
        e.x += dx * alpha;
        e.y += dy * alpha;
        e.z += dz * alpha;
      }
      changed = true;
    }
  }
  if (eased.size > seen.size) {
    for (const id of [...eased.keys()]) if (!seen.has(id)) eased.delete(id);
    changed = true;
  }
  return changed;
}

export function bumpAnim(): void {
  useAnim.setState((s) => ({ v: s.v + 1 }));
}
