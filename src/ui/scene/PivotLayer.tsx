// Renders heat-formed pivots as a heat-WRAP collar (the branch pipe wrapped
// around the receiving pipe at the joint — a swivel), replacing the old hinge
// glyph. With the "Solve" toggle on, an endpoint pivot also shows the receiving
// pipe extended 1" past the joint + a PVC endcap retaining ring so the wrap
// can't slide off. While the pivot tool is active, every eligible junction
// (a 2-member node) shows a clickable marker to create a pivot.
import type { ThreeEvent } from '@react-three/fiber';
import { canPivot, memberById, nodeById } from '../../design/docOps';
import { add, normalize, scale, sub } from '../../geometry/math3';
import { type Pivot, pipeSpec, type Vec3 } from '../../schema';
import { easedPos, useAnim } from '../../state/animStore';
import { useAppStore } from '../../state/appStore';
import { createPivotAt } from '../../state/editorActions';
import { useEditorStore } from '../../state/editorStore';
import { useThemeStore } from '../../state/themeStore';
import { scenePalette } from '../theme';
import { orientY, placeAxis } from './axis';
import { WrapStrip } from './WrapStrip';
import { buildWrapMesh } from './wrapMesh';

const EXTENSION_M = 0.0254; // 1" of receiving pipe past an endpoint pivot

function PivotWrap({
  pivot,
  solved,
  accent,
  pvc,
}: {
  pivot: Pivot;
  solved: boolean;
  accent: string;
  pvc: string;
}) {
  const design = useAppStore.getState().current;
  if (!design) return null;
  const at = (id: string): Vec3 | undefined => easedPos(id) ?? nodeById(design, id)?.position;
  const node = at(pivot.nodeId);
  const recv = memberById(design, pivot.memberA); // the receiving pipe
  const wrapM = memberById(design, pivot.memberB); // the pipe that wraps it
  if (!node || recv?.kind !== 'straight' || !wrapM) {
    // fall back to a small glyph when the geometry isn't a straight receiver
    return node ? (
      <mesh position={[node.x, node.y, node.z]} quaternion={orientY(pivot.axis)}>
        <cylinderGeometry args={[0.017, 0.017, 0.055, 18]} />
        <meshStandardMaterial color={accent} roughness={0.4} metalness={0.1} />
      </mesh>
    ) : null;
  }
  const farA = recv.nodeA === pivot.nodeId ? recv.nodeB : recv.nodeA;
  const farB = wrapM.nodeA === pivot.nodeId ? wrapM.nodeB : wrapM.nodeA;
  const aPos = at(farA);
  const bPos = at(farB);
  if (!aPos || !bPos) return null;
  const outward = normalize(sub(node, aPos)); // receiving pipe, past the joint
  const odRecv = pipeSpec(recv.size).odM;

  const mesh = buildWrapMesh({
    through: { a: aPos, b: node, odM: odRecv },
    wrapPoint: node,
    branchDir: normalize(sub(bPos, node)),
    branchODM: pipeSpec(wrapM.size).odM,
    rigid: false, // a pivot swivel — no screws, accent tint
  });
  if (!mesh) return null;

  const stubEnd = add(node, scale(outward, EXTENSION_M));
  const stub = solved ? placeAxis(node, stubEnd) : null;

  return (
    <group>
      <WrapStrip mesh={mesh} color={accent} />
      {solved && stub && (
        <>
          {/* 1" of receiving pipe past the joint */}
          <mesh position={stub.mid} quaternion={stub.quat} castShadow>
            <cylinderGeometry args={[odRecv / 2, odRecv / 2, stub.len, 20]} />
            <meshPhysicalMaterial color={pvc} roughness={0.38} clearcoat={0.5} />
          </mesh>
          {/* PVC endcap retaining ring at the stub end */}
          <mesh
            position={[stubEnd.x, stubEnd.y, stubEnd.z]}
            quaternion={orientY(outward)}
            castShadow
          >
            <cylinderGeometry args={[odRecv * 0.66, odRecv * 0.66, odRecv * 0.5, 20]} />
            <meshPhysicalMaterial color={pvc} roughness={0.38} clearcoat={0.5} />
          </mesh>
        </>
      )}
    </group>
  );
}

export function PivotLayer() {
  useAnim((s) => s.v);
  const design = useAppStore((s) => s.current);
  const tool = useEditorStore((s) => s.tool);
  const solved = useEditorStore((s) => s.fabricationSolved);
  const night = useThemeStore((s) => s.night);
  if (!design) return null;
  const pal = scenePalette(night);
  const at = (id: string): Vec3 | undefined => easedPos(id) ?? nodeById(design, id)?.position;

  return (
    <>
      {design.pivots.map((pv) => (
        <PivotWrap key={pv.id} pivot={pv} solved={solved} accent={pal.accent} pvc={pal.pvc} />
      ))}

      {tool === 'pivot' &&
        design.nodes
          .filter((n) => canPivot(design, n.id))
          .map((n) => {
            const p = at(n.id);
            if (!p) return null;
            const click = (e: ThreeEvent<MouseEvent>) => {
              e.stopPropagation();
              createPivotAt(n.id);
            };
            return (
              // biome-ignore lint/a11y/noStaticElementInteractions: r3f <mesh> is a three.js scene node, not a DOM element
              <mesh key={n.id} position={[p.x, p.y, p.z]} onClick={click}>
                <sphereGeometry args={[0.022, 16, 12]} />
                <meshBasicMaterial color={pal.accent} transparent opacity={0.55} />
              </mesh>
            );
          })}
    </>
  );
}
