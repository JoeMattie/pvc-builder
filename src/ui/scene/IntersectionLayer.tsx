// Intersection highlighting (planfile §6): outline members whose pipe volumes
// overlap in red — rendered as a slightly-enlarged translucent red shell over
// the offending straight cylinders / formed tubes. Skipped for large designs.
import { nodeById } from '../../design/docOps';
import { intersectingMembers } from '../../design/intersections';
import { type FormedMember, pipeSpec, type Vec3 } from '../../schema';
import { easedPos, useAnim } from '../../state/animStore';
import { useAppStore } from '../../state/appStore';
import { useEditorStore } from '../../state/editorStore';
import { useThemeStore } from '../../state/themeStore';
import { scenePalette } from '../theme';
import { placeAxis } from './axis';
import { formedCurve } from './FormedLayer';

const MAX_INTERSECT_MEMBERS = 800;
const SHELL = 1.28;
const BASE_OPACITY = 0.38;
/** ghosted like everything else outside an entered group (see instancing.ts) */
const DIM_OPACITY = 0.08;

export function IntersectionLayer() {
  useAnim((s) => s.v);
  const design = useAppStore((s) => s.current);
  const enteredGroupId = useEditorStore((s) => s.enteredGroupId);
  const night = useThemeStore((s) => s.night);
  if (!design || design.members.length > MAX_INTERSECT_MEMBERS) return null;

  const hits = intersectingMembers(design);
  if (!hits.size) return null;
  const red = scenePalette(night).conflict;
  const at = (id: string): Vec3 | undefined => easedPos(id) ?? nodeById(design, id)?.position;
  const entered = enteredGroupId ? design.groups.find((g) => g.id === enteredGroupId) : undefined;
  const active = entered ? new Set(entered.memberIds) : null;
  const opacityFor = (memberId: string) =>
    active && !active.has(memberId) ? DIM_OPACITY : BASE_OPACITY;

  return (
    <>
      {design.members
        .filter((m) => hits.has(m.id))
        .map((m) => {
          const r = (pipeSpec(m.size).odM / 2) * SHELL;
          if (m.kind === 'formed') {
            const curve = formedCurve(m as FormedMember, at);
            if (!curve) return null;
            const segs = Math.max(24, (m.controlPoints.length + 1) * 20);
            return (
              <mesh key={m.id}>
                <tubeGeometry args={[curve, segs, r, 12, false]} />
                <meshBasicMaterial
                  color={red}
                  transparent
                  opacity={opacityFor(m.id)}
                  depthWrite={false}
                />
              </mesh>
            );
          }
          const a = at(m.nodeA);
          const b = at(m.nodeB);
          const placed = a && b ? placeAxis(a, b) : null;
          if (!placed) return null;
          return (
            <mesh key={m.id} position={placed.mid} quaternion={placed.quat}>
              <cylinderGeometry args={[r, r, placed.len, 16]} />
              <meshBasicMaterial
                color={red}
                transparent
                opacity={opacityFor(m.id)}
                depthWrite={false}
              />
            </mesh>
          );
        })}
    </>
  );
}
