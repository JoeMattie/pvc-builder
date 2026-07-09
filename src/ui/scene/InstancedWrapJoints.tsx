// Instanced renderer for WRAPPED (swivel) pivots — the green "loops once around
// the run + arrowhead" indicator. On a dense model (e.g. the T-rex random-wrapped
// example, ~390 of them) drawing each as its own swept TubeGeometry is the same
// per-frame-mesh cost the free hubs had, so we bake ONE canonical arrow (loop +
// cone, in the joint's local frame) and instance it: each joint just re-orients +
// scales that rigid shape per frame via a basis matrix (the loop doesn't deform as
// the branch swivels — it rides the receiver axis). Two draw calls for all of them.
//
// Rigid (anchor, off-90°) wraps keep the declarative WrapJoint (pin variant, rare);
// this handles mode 'wrapped' only. See DECISIONS + ui/scene/CONTEXT.
import type { ThreeEvent } from '@react-three/fiber';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  CatmullRomCurve3,
  Color,
  ConeGeometry,
  type InstancedMesh,
  Matrix4,
  Quaternion,
  TubeGeometry,
  Vector3,
} from 'three';
import { memberById, nodeById } from '../../design/docOps';
import { dot, normalize, scale, sub } from '../../geometry/math3';
import { pipeSpec, type Vec3 } from '../../schema';
import { easedPos } from '../../state/animStore';
import { useAppStore } from '../../state/appStore';
import { useEditorStore } from '../../state/editorStore';
import { wrapFrameMatrix } from './instancing';
import { WRAP_END_GAP_M } from './pipeModel';
import { buildWrapArrow } from './wrapArrow';

const MAX_JOINT_MEMBERS = 800;
const WRAP_GREEN = '#2fa84f';
const SELECT_BLUE = '#2a78d6';

// ── canonical arrow, baked once in the joint LOCAL frame (X = radial toward the
// branch, Y = receiver axis, Z = swing). Built at 1/2" pipe; each instance scales
// by its own wrap-radius / this one (=1 for a 1/2" joint, exact).
const CANON_SPEC = pipeSpec('1/2"');
const CANON_R = CANON_SPEC.odM / 2;
const CANON = buildWrapArrow({
  node: { x: 0, y: 0, z: 0 },
  axis: { x: 0, y: 1, z: 0 },
  receiverR: CANON_R,
  moverTip: { x: CANON_R + WRAP_END_GAP_M, y: 0, z: 0 },
  branchOut: { x: 1, y: 0, z: 0 },
  branchODM: CANON_SPEC.odM,
})!;
const CANON_RWRAP = CANON_R + Math.max(CANON_SPEC.odM * 0.12, 0.0025);
const CANON_TUBE = new TubeGeometry(
  new CatmullRomCurve3(CANON.path.map((p) => new Vector3(p.x, p.y, p.z))),
  72,
  CANON.tubeR,
  8,
  false,
);
const CANON_CONE = new ConeGeometry(1, 1, 16); // unit — scaled via CONE_LOCAL
const CONE_LOCAL = new Matrix4().compose(
  new Vector3(CANON.tip.x, CANON.tip.y, CANON.tip.z),
  new Quaternion().setFromUnitVectors(
    new Vector3(0, 1, 0),
    new Vector3(CANON.tipDir.x, CANON.tipDir.y, CANON.tipDir.z).normalize(),
  ),
  new Vector3(CANON.tubeR * 2.6, Math.max(CANON.tubeR * 4.5, 0.014), CANON.tubeR * 2.6),
);

interface Wrap {
  jointId: string;
  nodeId: string;
  recvA: string;
  recvB: string;
  moverFar: string;
  receiverR: number;
  branchODM: number;
  nodePos: Vec3;
  recvAPos: Vec3;
  recvBPos: Vec3;
  moverFarPos: Vec3;
}

function buildWrapSpec(design: ReturnType<typeof useAppStore.getState>['current']): Wrap[] {
  if (!design || design.members.length > MAX_JOINT_MEMBERS) return [];
  const wraps: Wrap[] = [];
  for (const j of design.joints) {
    if (j.mode !== 'wrapped') continue; // rigid/anchor + free handled elsewhere
    const recv = memberById(design, j.receiver);
    const mover = memberById(design, j.mover);
    if (recv?.kind !== 'straight' || !mover) continue;
    const moverFar = mover.nodeA === j.nodeId ? mover.nodeB : mover.nodeA;
    const nodePos = nodeById(design, j.nodeId)?.position;
    const recvAPos = nodeById(design, recv.nodeA)?.position;
    const recvBPos = nodeById(design, recv.nodeB)?.position;
    const moverFarPos = nodeById(design, moverFar)?.position;
    if (!nodePos || !recvAPos || !recvBPos || !moverFarPos) continue;
    wraps.push({
      jointId: j.id,
      nodeId: j.nodeId,
      recvA: recv.nodeA,
      recvB: recv.nodeB,
      moverFar,
      receiverR: pipeSpec(recv.size).odM / 2,
      branchODM: pipeSpec(mover.size).odM,
      nodePos,
      recvAPos,
      recvBPos,
      moverFarPos,
    });
  }
  return wraps;
}

const anyPerp = (u: Vec3): Vec3 => {
  const t = Math.abs(u.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  return normalize({
    x: u.y * t.z - u.z * t.y,
    y: u.z * t.x - u.x * t.z,
    z: u.x * t.y - u.y * t.x,
  });
};

export function InstancedWrapJoints() {
  const design = useAppStore((s) => s.current);
  const selectable = useEditorStore((s) => s.tool === 'select');
  const selectedJointId = useEditorStore((s) => s.selectedJointId);

  const spec = useMemo(() => buildWrapSpec(design), [design]);
  const loopRef = useRef<InstancedMesh>(null);
  const coneRef = useRef<InstancedMesh>(null);
  const mat = useRef(new Matrix4()).current;

  useFrame(() => {
    const loop = loopRef.current;
    const cone = coneRef.current;
    if (!loop || !cone) return;
    for (let i = 0; i < spec.length; i++) {
      const w = spec[i];
      if (!w) continue;
      const node = easedPos(w.nodeId) ?? w.nodePos;
      const u = normalize(sub(easedPos(w.recvB) ?? w.recvBPos, easedPos(w.recvA) ?? w.recvAPos));
      const branchOut = normalize(sub(easedPos(w.moverFar) ?? w.moverFarPos, node));
      let er = sub(branchOut, scale(u, dot(branchOut, u)));
      er = Math.hypot(er.x, er.y, er.z) < 1e-6 ? anyPerp(u) : normalize(er);
      const rWrap = w.receiverR + Math.max(w.branchODM * 0.12, 0.0025);
      const s = rWrap / CANON_RWRAP;
      wrapFrameMatrix(mat, node, er, u, s);
      loop.setMatrixAt(i, mat);
      wrapFrameMatrix(mat, node, er, u, s, CONE_LOCAL);
      cone.setMatrixAt(i, mat);
    }
    loop.instanceMatrix.needsUpdate = true;
    cone.instanceMatrix.needsUpdate = true;
  });

  // colours (green, or select-blue) — on change, not per frame
  useEffect(() => {
    const loop = loopRef.current;
    const cone = coneRef.current;
    if (!loop || !cone) return;
    const green = new Color(WRAP_GREEN);
    const sel = new Color(SELECT_BLUE);
    for (let i = 0; i < spec.length; i++) {
      const c = selectable && spec[i]?.jointId === selectedJointId ? sel : green;
      loop.setColorAt(i, c);
      cone.setColorAt(i, c);
    }
    if (loop.instanceColor) loop.instanceColor.needsUpdate = true;
    if (cone.instanceColor) cone.instanceColor.needsUpdate = true;
  }, [spec, selectedJointId, selectable]);

  if (!spec.length) return null;

  const onSelect = selectable
    ? (ev: ThreeEvent<MouseEvent>) => {
        if (ev.instanceId == null) return;
        ev.stopPropagation();
        const id = spec[ev.instanceId]?.jointId;
        if (id) useEditorStore.getState().selectJoint(id);
      }
    : undefined;

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: r3f mesh is a three.js scene node */}
      <instancedMesh
        ref={loopRef}
        args={[CANON_TUBE, undefined, spec.length]}
        frustumCulled={false}
        castShadow
        onClick={onSelect}
      >
        <meshStandardMaterial roughness={0.5} metalness={0.15} />
      </instancedMesh>
      <instancedMesh
        ref={coneRef}
        args={[CANON_CONE, undefined, spec.length]}
        frustumCulled={false}
      >
        <meshStandardMaterial roughness={0.5} metalness={0.1} />
      </instancedMesh>
    </>
  );
}
