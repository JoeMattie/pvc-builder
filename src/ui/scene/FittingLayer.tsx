// Renders auto-resolved fittings at each junction and flags conflicts
// (planfile §4/§6). Fitting TYPES come from the snapped document (stable), but
// the geometry is placed at eased render positions so fittings glide with the
// pipe. Skipped for large designs (e.g. the T-rex wireframe) — a mesh with
// high-degree vertices is all conflicts and needs no connectors.
import { memberById, nodeById } from '../../design/docOps';
import { resolveFittings } from '../../design/fittings';
import { normalize, sub } from '../../geometry/math3';
import type { Vec3 } from '../../schema';
import { easedPos, useAnim } from '../../state/animStore';
import { useAppStore } from '../../state/appStore';
import { useThemeStore } from '../../state/themeStore';
import { scenePalette } from '../theme';
import { placeAxis } from './axis';
import { buildFittingMesh, type FittingCyl } from './fittingMesh';

/** Above this many members, skip fitting resolution/rendering entirely. */
const MAX_FITTING_MEMBERS = 200;

function Cyl({ c, color }: { c: FittingCyl; color: string }) {
  const placed = placeAxis(c.a, c.b);
  if (!placed) return null;
  return (
    <mesh position={placed.mid} quaternion={placed.quat} castShadow>
      <cylinderGeometry args={[c.radiusM, c.radiusM, placed.len, 18]} />
      <meshPhysicalMaterial color={color} roughness={0.5} metalness={0} clearcoat={0.4} />
    </mesh>
  );
}

export function FittingLayer() {
  // re-render while easing so fittings track the pipe
  useAnim((s) => s.v);
  const design = useAppStore((s) => s.current);
  const night = useThemeStore((s) => s.night);
  if (!design || design.members.length > MAX_FITTING_MEMBERS) return null;

  const pal = scenePalette(night);
  const eased = (id: string): Vec3 =>
    easedPos(id) ?? nodeById(design, id)?.position ?? { x: 0, y: 0, z: 0 };
  const { fittings, conflicts } = resolveFittings(design);

  return (
    <>
      {fittings.map((f) => {
        // recompute position + end directions from eased node positions
        const position = eased(f.nodeId);
        const ends = f.ends.map((e) => {
          const m = memberById(design, e.memberId);
          const otherId = m ? (m.nodeA === f.nodeId ? m.nodeB : m.nodeA) : f.nodeId;
          return { ...e, dir: normalize(sub(eased(otherId), position)) };
        });
        const mesh = buildFittingMesh({ ...f, position, ends });
        return (
          <group key={f.nodeId}>
            {mesh.prims.map((p, i) =>
              p.kind === 'cylinder' ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: primitives are positional per fitting
                <Cyl key={i} c={p} color={pal.fitting} />
              ) : (
                <mesh
                  // biome-ignore lint/suspicious/noArrayIndexKey: primitives are positional per fitting
                  key={i}
                  position={[p.center.x, p.center.y, p.center.z]}
                  castShadow
                >
                  <sphereGeometry args={[p.radiusM, 18, 14]} />
                  <meshPhysicalMaterial color={pal.fitting} roughness={0.5} clearcoat={0.4} />
                </mesh>
              ),
            )}
          </group>
        );
      })}

      {conflicts.map((c) => {
        const p = eased(c.nodeId);
        return (
          <mesh key={c.nodeId} position={[p.x, p.y, p.z]}>
            <sphereGeometry args={[0.02, 16, 12]} />
            <meshBasicMaterial color={pal.conflict} transparent opacity={0.55} />
          </mesh>
        );
      })}
    </>
  );
}
