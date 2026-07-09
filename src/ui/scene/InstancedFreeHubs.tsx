// Instanced renderer for FREE (ball) hubs — the dominant mesh cost on dense
// articulated models (e.g. the T-rex universal-pivots example puts a free hub at
// every node, ~2.4k meshes as one-per-part). Every hub's ball, per-pipe eye
// bolt, and knotted cord are drawn from three InstancedMesh (one draw call each)
// instead of N separate meshes, and their transforms are refreshed imperatively
// each frame from the eased render positions — no per-frame React reconciliation.
// The declarative equivalent (one ball + eyes + cords per hub) lived in
// JointLayer's FreeHub; this replaces it for end-to-end free hubs. On-body free
// joints and wrap/anchor joints stay in JointLayer (few, keep interactivity).
import type { ThreeEvent } from '@react-three/fiber';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Color, type InstancedMesh, Matrix4 } from 'three';
import { incidentMembers, nodeById } from '../../design/docOps';
import { add, normalize, scale, sub } from '../../geometry/math3';
import { type Joint, pipeSpec, type Vec3 } from '../../schema';
import { easedPos } from '../../state/animStore';
import { useAppStore } from '../../state/appStore';
import { useEditorStore } from '../../state/editorStore';
import { useThemeStore } from '../../state/themeStore';
import { scenePalette } from '../theme';
import { cylinderMatrix, ringMatrix, sphereMatrix } from './instancing';
import { FREE_JOINT_GAP_M } from './pipeModel';

const MAX_JOINT_MEMBERS = 800; // parity with JointLayer's gate
const CORD_COLOR = '#c9b48a';
const EYE_COLOR = '#6b7280';
const SELECT_BLUE = '#2a78d6';

interface HubEnd {
  farNodeId: string;
  farPos: Vec3;
}
interface Hub {
  jointId: string;
  nodeId: string;
  moverId: string;
  nodePos: Vec3;
  ballR: number;
  eyeR: number;
  cordR: number;
  ends: HubEnd[];
}
interface HubSpec {
  hubs: Hub[];
  endCount: number;
}

/** Structural spec (which hubs, their incident pipe ends, and radii). Recomputed
 * only when the design object changes — NOT per animation frame. */
function buildHubSpec(design: ReturnType<typeof useAppStore.getState>['current']): HubSpec {
  if (!design || design.members.length > MAX_JOINT_MEMBERS) return { hubs: [], endCount: 0 };
  // one representative free-hub joint per node (the pairwise records back it)
  const reps = new Map<string, Joint>();
  for (const j of design.joints)
    if (j.mode === 'free' && !j.onBody && !reps.has(j.nodeId)) reps.set(j.nodeId, j);
  const hubs: Hub[] = [];
  for (const [nodeId, rep] of reps) {
    const nodePos = nodeById(design, nodeId)?.position;
    if (!nodePos) continue;
    const incident = incidentMembers(design, nodeId).filter((m) => m.kind === 'straight');
    if (incident.length < 2) continue;
    const odMax = Math.max(...incident.map((m) => pipeSpec(m.size).odM));
    const ends: HubEnd[] = incident.map((m) => {
      const farNodeId = m.nodeA === nodeId ? m.nodeB : m.nodeA;
      return { farNodeId, farPos: nodeById(design, farNodeId)?.position ?? nodePos };
    });
    hubs.push({
      jointId: rep.id,
      nodeId,
      moverId: rep.mover,
      nodePos,
      ballR: odMax * 0.55,
      eyeR: odMax * 0.42,
      cordR: odMax * 0.09,
      ends,
    });
  }
  return { hubs, endCount: hubs.reduce((s, h) => s + h.ends.length, 0) };
}

export function InstancedFreeHubs() {
  const design = useAppStore((s) => s.current);
  const tool = useEditorStore((s) => s.tool);
  const selectedJointId = useEditorStore((s) => s.selectedJointId);
  const night = useThemeStore((s) => s.night);

  const spec = useMemo(() => buildHubSpec(design), [design]);
  const ballRef = useRef<InstancedMesh>(null);
  const eyeRef = useRef<InstancedMesh>(null);
  const cordRef = useRef<InstancedMesh>(null);
  const mat = useRef(new Matrix4()).current;

  const editing = tool === 'select' || tool === 'move' || tool === 'rotate';
  const selectable = tool === 'select';
  const accent = scenePalette(night).accent;

  // per-frame: refresh every instance matrix from the eased render positions
  useFrame(() => {
    const ball = ballRef.current;
    const eye = eyeRef.current;
    const cord = cordRef.current;
    if (!ball) return;
    let e = 0;
    for (let h = 0; h < spec.hubs.length; h++) {
      const hub = spec.hubs[h];
      if (!hub) continue;
      const node = easedPos(hub.nodeId) ?? hub.nodePos;
      sphereMatrix(mat, node, hub.ballR);
      ball.setMatrixAt(h, mat);
      for (const end of hub.ends) {
        const far = easedPos(end.farNodeId) ?? end.farPos;
        const dir = normalize(sub(far, node));
        const tip = add(node, scale(dir, FREE_JOINT_GAP_M));
        if (eye) {
          ringMatrix(mat, tip, dir, hub.eyeR);
          eye.setMatrixAt(e, mat);
        }
        if (cord && cylinderMatrix(mat, tip, node, hub.cordR)) cord.setMatrixAt(e, mat);
        e++;
      }
    }
    ball.instanceMatrix.needsUpdate = true;
    if (eye) eye.instanceMatrix.needsUpdate = true;
    if (cord) cord.instanceMatrix.needsUpdate = true;
  });

  // ball colours (accent, or select-blue for the selected hub) — set on change,
  // not per frame
  useEffect(() => {
    const ball = ballRef.current;
    if (!ball) return;
    const sel = new Color(SELECT_BLUE);
    const base = new Color(accent);
    for (let h = 0; h < spec.hubs.length; h++) {
      const isSel = selectable && spec.hubs[h]?.jointId === selectedJointId;
      ball.setColorAt(h, isSel ? sel : base); // setColorAt copies into the buffer
    }
    if (ball.instanceColor) ball.instanceColor.needsUpdate = true;
  }, [spec, selectedJointId, selectable, accent]);

  if (!spec.hubs.length) return null;

  const onBallClick = selectable
    ? (ev: ThreeEvent<MouseEvent>) => {
        if (ev.instanceId == null) return;
        ev.stopPropagation();
        const jointId = spec.hubs[ev.instanceId]?.jointId;
        if (jointId) useEditorStore.getState().selectJoint(jointId);
      }
    : undefined;
  const onBallContext = editing
    ? (ev: ThreeEvent<MouseEvent>) => {
        if (ev.instanceId == null) return;
        ev.stopPropagation();
        const hub = spec.hubs[ev.instanceId];
        if (!hub) return;
        const ne = ev.nativeEvent as MouseEvent;
        useEditorStore
          .getState()
          .openJoinMenu({ nodeId: hub.nodeId, moverId: hub.moverId, x: ne.clientX, y: ne.clientY });
      }
    : undefined;
  const onBallHover = editing
    ? (ev: ThreeEvent<PointerEvent>) => {
        if (ev.instanceId == null) return;
        const jointId = spec.hubs[ev.instanceId]?.jointId;
        if (jointId) useEditorStore.getState().setHoveredSceneItem({ kind: 'joint', id: jointId });
      }
    : undefined;
  const onBallHoverOut = editing
    ? () => {
        const store = useEditorStore.getState();
        if (store.hoveredSceneItem?.kind === 'joint') store.setHoveredSceneItem(null);
      }
    : undefined;

  return (
    <>
      {/* one draw call: every hub ball */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: r3f mesh is a three.js scene node, not a DOM element */}
      <instancedMesh
        ref={ballRef}
        args={[undefined, undefined, spec.hubs.length]}
        frustumCulled={false}
        castShadow
        onClick={onBallClick}
        onContextMenu={onBallContext}
        onPointerMove={onBallHover}
        onPointerOut={onBallHoverOut}
      >
        <sphereGeometry args={[1, 20, 16]} />
        <meshPhysicalMaterial roughness={0.3} metalness={0.1} clearcoat={0.6} />
      </instancedMesh>
      {/* one draw call: every eye bolt */}
      {spec.endCount > 0 && (
        <instancedMesh
          ref={eyeRef}
          args={[undefined, undefined, spec.endCount]}
          frustumCulled={false}
        >
          <torusGeometry args={[1, 0.28, 12, 20]} />
          <meshStandardMaterial color={EYE_COLOR} roughness={0.35} metalness={0.85} />
        </instancedMesh>
      )}
      {/* one draw call: every knotted cord */}
      {spec.endCount > 0 && (
        <instancedMesh
          ref={cordRef}
          args={[undefined, undefined, spec.endCount]}
          frustumCulled={false}
        >
          <cylinderGeometry args={[1, 1, 1, 8]} />
          <meshStandardMaterial color={CORD_COLOR} roughness={0.9} metalness={0} />
        </instancedMesh>
      )}
    </>
  );
}
