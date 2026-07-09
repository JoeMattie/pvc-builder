// Renders auto-resolved fittings at each junction and flags conflicts
// (planfile §4/§6). Fitting TYPES come from the snapped document (stable), so
// they're resolved ONCE (useMemo); the geometry is rebuilt from eased positions
// and drawn INSTANCED — every fitting cylinder in one draw call, every hub sphere
// in another, every conflict marker in a third — so a junction-dense model (e.g.
// the rigid T-rex, ~260 fittings) is a handful of draw calls, not ~340 meshes.
// The per-frame rebuild is gated on the anim tick so an idle scene costs nothing.
import { type ThreeEvent, useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { type InstancedMesh, Matrix4 } from 'three';
import { memberById, nodeById } from '../../design/docOps';
import { type FittingEnd, type FittingType, resolveFittings } from '../../design/fittings';
import { normalize, sub } from '../../geometry/math3';
import type { Vec3 } from '../../schema';
import { easedPos, useAnim } from '../../state/animStore';
import { useAppStore } from '../../state/appStore';
import { useEditorStore } from '../../state/editorStore';
import { useThemeStore } from '../../state/themeStore';
import { scenePalette } from '../theme';
import { buildFittingMesh } from './fittingMesh';
import { cylinderMatrix, hideMatrix, sphereMatrix } from './instancing';

/** Above this many members, skip fitting resolution/rendering entirely. */
const MAX_FITTING_MEMBERS = 800;

interface FitSpec {
  nodeId: string;
  type: FittingType;
  reducing: boolean;
  ends: { memberId: string; size: FittingEnd['size']; otherId: string }[];
}

function buildSpec(design: ReturnType<typeof useAppStore.getState>['current']): {
  fits: FitSpec[];
  conflictNodes: string[];
  cylNodes: string[];
  sphNodes: string[];
  cylCount: number;
  sphCount: number;
} {
  if (!design || design.members.length > MAX_FITTING_MEMBERS)
    return { fits: [], conflictNodes: [], cylNodes: [], sphNodes: [], cylCount: 0, sphCount: 0 };
  const { fittings, conflicts } = resolveFittings(design);
  const fits: FitSpec[] = fittings.map((f) => ({
    nodeId: f.nodeId,
    type: f.type,
    reducing: f.reducing,
    ends: f.ends.map((e) => {
      const m = memberById(design, e.memberId);
      return {
        memberId: e.memberId,
        size: e.size,
        otherId: m ? (m.nodeA === f.nodeId ? m.nodeB : m.nodeA) : f.nodeId,
      };
    }),
  }));
  // count prims once (at doc positions) to size the instance buffers — the prim
  // count per fitting is a function of its type, which is stable
  const at = (id: string): Vec3 => nodeById(design, id)?.position ?? { x: 0, y: 0, z: 0 };
  let cylCount = 0;
  let sphCount = 0;
  const cylNodes: string[] = [];
  const sphNodes: string[] = [];
  for (const f of fits) {
    const mesh = fittingMeshOf(f, at);
    for (const p of mesh.prims) {
      if (p.kind === 'cylinder') {
        cylCount++;
        cylNodes.push(f.nodeId);
      } else {
        sphCount++;
        sphNodes.push(f.nodeId);
      }
    }
  }
  return {
    fits,
    conflictNodes: conflicts.map((c) => c.nodeId),
    cylNodes,
    sphNodes,
    cylCount,
    sphCount,
  };
}

function fittingMeshOf(f: FitSpec, at: (id: string) => Vec3) {
  const position = at(f.nodeId);
  const ends = f.ends.map((e) => ({
    memberId: e.memberId,
    size: e.size,
    dir: normalize(sub(at(e.otherId), position)),
  }));
  return buildFittingMesh({ nodeId: f.nodeId, type: f.type, reducing: f.reducing, position, ends });
}

export function FittingLayer() {
  const design = useAppStore((s) => s.current);
  const night = useThemeStore((s) => s.night);
  const spec = useMemo(() => buildSpec(design), [design]);
  const cylRef = useRef<InstancedMesh>(null);
  const sphRef = useRef<InstancedMesh>(null);
  const conflictRef = useRef<InstancedMesh>(null);
  const mat = useRef(new Matrix4()).current;
  const lastV = useRef(-1);

  const fill = () => {
    if (!design) return;
    const at = (id: string): Vec3 =>
      easedPos(id) ?? nodeById(design, id)?.position ?? { x: 0, y: 0, z: 0 };
    const cyl = cylRef.current;
    const sph = sphRef.current;
    let ci = 0;
    let si = 0;
    for (const f of spec.fits) {
      const mesh = fittingMeshOf(f, at);
      for (const p of mesh.prims) {
        if (p.kind === 'cylinder') {
          if (cyl && ci < spec.cylCount) {
            if (!cylinderMatrix(mat, p.a, p.b, p.radiusM)) hideMatrix(mat);
            cyl.setMatrixAt(ci++, mat);
          }
        } else if (sph && si < spec.sphCount) {
          sphereMatrix(mat, p.center, p.radiusM);
          sph.setMatrixAt(si++, mat);
        }
      }
    }
    if (cyl) {
      for (let i = ci; i < spec.cylCount; i++) {
        hideMatrix(mat);
        cyl.setMatrixAt(i, mat);
      }
      cyl.instanceMatrix.needsUpdate = true;
    }
    if (sph) {
      for (let i = si; i < spec.sphCount; i++) {
        hideMatrix(mat);
        sph.setMatrixAt(i, mat);
      }
      sph.instanceMatrix.needsUpdate = true;
    }
    const conflict = conflictRef.current;
    if (conflict) {
      for (let i = 0; i < spec.conflictNodes.length; i++) {
        const id = spec.conflictNodes[i];
        sphereMatrix(mat, id ? at(id) : { x: 0, y: 0, z: 0 }, 0.02);
        conflict.setMatrixAt(i, mat);
      }
      conflict.instanceMatrix.needsUpdate = true;
    }
  };

  // fill once on (re)build; then only when the eased positions actually change
  // (anim tick), so an idle scene pays nothing per frame
  // biome-ignore lint/correctness/useExhaustiveDependencies: fill closes over spec; re-run on spec change
  useEffect(() => {
    lastV.current = -1;
    fill();
    lastV.current = useAnim.getState().v;
  }, [spec]);
  useFrame(() => {
    const v = useAnim.getState().v;
    if (v === lastV.current) return;
    lastV.current = v;
    fill();
  });

  if (!design || (!spec.fits.length && !spec.conflictNodes.length)) return null;
  const pal = scenePalette(night);
  const hoverNode = (nodeId: string | undefined) => {
    const store = useEditorStore.getState();
    if (nodeId) store.setHoveredSceneItem({ kind: 'fitting', id: nodeId });
    else if (store.hoveredSceneItem?.kind === 'fitting') store.setHoveredSceneItem(null);
  };
  const onCylHover = (ev: ThreeEvent<PointerEvent>) => {
    ev.stopPropagation();
    hoverNode(spec.cylNodes[ev.instanceId ?? -1]);
  };
  const onSphHover = (ev: ThreeEvent<PointerEvent>) => {
    ev.stopPropagation();
    hoverNode(spec.sphNodes[ev.instanceId ?? -1]);
  };
  const onConflictHover = (ev: ThreeEvent<PointerEvent>) => {
    ev.stopPropagation();
    hoverNode(spec.conflictNodes[ev.instanceId ?? -1]);
  };
  const onHoverOut = () => hoverNode(undefined);

  return (
    <>
      {spec.cylCount > 0 && (
        <instancedMesh
          key={`fc-${spec.cylCount}`}
          ref={cylRef}
          args={[undefined, undefined, spec.cylCount]}
          frustumCulled={false}
          castShadow
          onPointerMove={onCylHover}
          onPointerOut={onHoverOut}
        >
          <cylinderGeometry args={[1, 1, 1, 18]} />
          <meshPhysicalMaterial color={pal.fitting} roughness={0.5} metalness={0} clearcoat={0.4} />
        </instancedMesh>
      )}
      {spec.sphCount > 0 && (
        <instancedMesh
          key={`fs-${spec.sphCount}`}
          ref={sphRef}
          args={[undefined, undefined, spec.sphCount]}
          frustumCulled={false}
          castShadow
          onPointerMove={onSphHover}
          onPointerOut={onHoverOut}
        >
          <sphereGeometry args={[1, 18, 14]} />
          <meshPhysicalMaterial color={pal.fitting} roughness={0.5} metalness={0} clearcoat={0.4} />
        </instancedMesh>
      )}
      {spec.conflictNodes.length > 0 && (
        <instancedMesh
          key={`fx-${spec.conflictNodes.length}`}
          ref={conflictRef}
          args={[undefined, undefined, spec.conflictNodes.length]}
          frustumCulled={false}
          onPointerMove={onConflictHover}
          onPointerOut={onHoverOut}
        >
          <sphereGeometry args={[1, 16, 12]} />
          <meshBasicMaterial color={pal.conflict} transparent opacity={0.55} />
        </instancedMesh>
      )}
    </>
  );
}
