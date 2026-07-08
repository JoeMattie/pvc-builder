// Renders unified pipe JOINTS (planfile §4/§5). Every non-default connection is
// one record:
//   • wrapped — the mover swivels about the receiver: the branch pipe stops ~1"
//     short of the run (see pipeModel) and a GREEN arrow leaves that open end,
//     loops once around the run, and returns near the start — "swivels here".
//   • anchor (on-body rigid union, no standard fitting) — the same loop but
//     STEEL, capped by a red locking PIN instead of an arrowhead: "fixed here".
//   • free — a ball joint: the two pipe ends are pulled back (see pipeModel), an
//     eye bolt rings each end, a knotted cord runs between them, and a ball sits
//     at the joint.
// Everything is placed at eased render positions so it glides with the pipe.
import { Html } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { ArrowLeftRight } from 'lucide-react';
import { CatmullRomCurve3, Vector3 } from 'three';
import { memberById, nodeById } from '../../design/docOps';
import { add, normalize, scale, sub } from '../../geometry/math3';
import { type Joint, pipeSpec, type Vec3 } from '../../schema';
import { easedPos, useAnim } from '../../state/animStore';
import { useAppStore } from '../../state/appStore';
import { swapJointReceiver } from '../../state/editorActions';
import { useEditorStore } from '../../state/editorStore';
import { useThemeStore } from '../../state/themeStore';
import { scenePalette } from '../theme';
import { orientY, orientZ, placeAxis } from './axis';
import { buildFittingMesh, type FittingCyl } from './fittingMesh';
import { anchorRendersAsTee } from './jointStyle';
import { FREE_JOINT_GAP_M, WRAP_END_GAP_M } from './pipeModel';
import { buildWrapArrow } from './wrapArrow';

const MAX_JOINT_MEMBERS = 200;
const CORD_COLOR = '#c9b48a'; // knotted natural cord
const EYE_COLOR = '#6b7280'; // galvanised eye bolt
const WRAP_GREEN = '#2fa84f'; // swivel arrow (can rotate)
const RIGID_STEEL = '#8b9099'; // rigid loop (locked)
const PIN_HEAD = '#d64545'; // locking pin head
const PIN_SHAFT = '#b9bec6';
const SELECT_BLUE = '#2a78d6';

/** A rigid on-body union at ~90°: a standard socket TEE sleeving the run + branch
 * (the branch pipe runs full into the hub — see pipeModel). White PVC, matching
 * the auto-resolved fittings. */
function AnchorTee({
  joint,
  selectable,
  selected,
  fitting,
  onContext,
}: {
  joint: Joint;
  selectable: boolean;
  selected: boolean;
  fitting: string;
  onContext?: (e: ThreeEvent<MouseEvent>) => void;
}) {
  const design = useAppStore.getState().current;
  const eased = (id: string): Vec3 =>
    easedPos(id) ?? (design ? nodeById(design, id)?.position : undefined) ?? { x: 0, y: 0, z: 0 };
  const receiver = design ? memberById(design, joint.receiver) : undefined;
  const mover = design ? memberById(design, joint.mover) : undefined;
  if (receiver?.kind !== 'straight' || !mover) return null;

  const node = eased(joint.nodeId);
  const u = normalize(sub(eased(receiver.nodeB), eased(receiver.nodeA)));
  const farId = mover.nodeA === joint.nodeId ? mover.nodeB : mover.nodeA;
  const branch = normalize(sub(eased(farId), node));
  const mesh = buildFittingMesh({
    nodeId: joint.nodeId,
    type: 'tee',
    reducing: receiver.size !== mover.size,
    position: node,
    // the run passes straight through (±u); the branch tees off along `branch`
    ends: [
      { memberId: receiver.id, size: receiver.size, dir: u },
      { memberId: receiver.id, size: receiver.size, dir: scale(u, -1) },
      { memberId: mover.id, size: mover.size, dir: branch },
    ],
  });

  const color = selected ? SELECT_BLUE : fitting;
  const onSelect = selectable
    ? (e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        useEditorStore.getState().selectJoint(joint.id);
      }
    : undefined;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: r3f group is a scene node
    <group onContextMenu={onContext} onClick={onSelect}>
      {mesh.prims.map((p, i) =>
        p.kind === 'cylinder' ? (
          <TeeCyl
            // biome-ignore lint/suspicious/noArrayIndexKey: primitives are positional per fitting
            key={i}
            c={p}
            color={color}
          />
        ) : (
          <mesh
            // biome-ignore lint/suspicious/noArrayIndexKey: primitives are positional per fitting
            key={i}
            position={[p.center.x, p.center.y, p.center.z]}
            castShadow
          >
            <sphereGeometry args={[p.radiusM, 18, 14]} />
            <meshPhysicalMaterial color={color} roughness={0.5} metalness={0} clearcoat={0.4} />
          </mesh>
        ),
      )}
    </group>
  );
}

function TeeCyl({ c, color }: { c: FittingCyl; color: string }) {
  const placed = placeAxis(c.a, c.b);
  if (!placed) return null;
  return (
    <mesh position={placed.mid} quaternion={placed.quat} castShadow>
      <cylinderGeometry args={[c.radiusM, c.radiusM, placed.len, 18]} />
      <meshPhysicalMaterial color={color} roughness={0.5} metalness={0} clearcoat={0.4} />
    </mesh>
  );
}

/** A wrapped pivot (swivel arrow) or an on-body rigid union (pinned loop). */
function WrapJoint({
  joint,
  selectable,
  selected,
  onContext,
}: {
  joint: Joint;
  selectable: boolean;
  selected: boolean;
  onContext?: (e: ThreeEvent<MouseEvent>) => void;
}) {
  const design = useAppStore.getState().current;
  const eased = (id: string): Vec3 =>
    easedPos(id) ?? (design ? nodeById(design, id)?.position : undefined) ?? { x: 0, y: 0, z: 0 };

  const receiver = design ? memberById(design, joint.receiver) : undefined;
  const mover = design ? memberById(design, joint.mover) : undefined;

  const node = eased(joint.nodeId);
  const moverFar = mover?.nodeA === joint.nodeId ? mover?.nodeB : mover?.nodeA;
  const rigid = joint.mode === 'anchor';
  if (receiver?.kind !== 'straight' || !mover || !moverFar) return null;

  const rt = pipeSpec(receiver.size).odM / 2;
  const branchOut = normalize(sub(eased(moverFar), node));
  // recomputed each render — the parent only re-renders while easing, so this is
  // cheap when the model is at rest and correct while pipes glide
  const arrow = buildWrapArrow({
    node,
    axis: normalize(sub(eased(receiver.nodeB), eased(receiver.nodeA))),
    receiverR: rt,
    moverTip: add(node, scale(branchOut, rt + WRAP_END_GAP_M)),
    branchOut,
    branchODM: pipeSpec(mover.size).odM,
  });
  if (!arrow) return null;
  const curve = new CatmullRomCurve3(arrow.path.map((p) => new Vector3(p.x, p.y, p.z)));

  const bodyColor = selected ? SELECT_BLUE : rigid ? RIGID_STEEL : WRAP_GREEN;
  const onSelect = selectable
    ? (e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        useEditorStore.getState().selectJoint(joint.id);
      }
    : undefined;

  const headH = Math.max(arrow.tubeR * 4.5, 0.014);
  const headR = arrow.tubeR * 2.6;
  const pinLen = Math.max(arrow.tubeR * 8, 0.022);
  const pinHeadR = Math.max(arrow.tubeR * 3.2, 0.006);
  const pinMid = add(arrow.pinBase, scale(arrow.pinDir, pinLen / 2));
  const pinTop = add(arrow.pinBase, scale(arrow.pinDir, pinLen));

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: r3f group is a scene node
    <group onContextMenu={onContext} onClick={onSelect}>
      {/* the loop body swept once around the run */}
      <mesh castShadow>
        <tubeGeometry args={[curve, 72, arrow.tubeR, 8, false]} />
        <meshStandardMaterial color={bodyColor} roughness={0.5} metalness={rigid ? 0.5 : 0.1} />
      </mesh>
      {rigid ? (
        // locking pin: a shaft driven into the run + a round head
        <group>
          <mesh position={[pinMid.x, pinMid.y, pinMid.z]} quaternion={orientY(arrow.pinDir)}>
            <cylinderGeometry args={[arrow.tubeR * 0.8, arrow.tubeR * 0.8, pinLen, 12]} />
            <meshStandardMaterial color={PIN_SHAFT} roughness={0.35} metalness={0.85} />
          </mesh>
          <mesh position={[pinTop.x, pinTop.y, pinTop.z]} castShadow>
            <sphereGeometry args={[pinHeadR, 16, 12]} />
            <meshStandardMaterial color={selected ? SELECT_BLUE : PIN_HEAD} roughness={0.4} />
          </mesh>
        </group>
      ) : (
        // arrowhead closing the loop (the swivel direction)
        <mesh position={[arrow.tip.x, arrow.tip.y, arrow.tip.z]} quaternion={orientY(arrow.tipDir)}>
          <coneGeometry args={[headR, headH, 16]} />
          <meshStandardMaterial color={bodyColor} roughness={0.5} metalness={0.1} />
        </mesh>
      )}
    </group>
  );
}

/** A free (ball) pivot: eye bolts + knotted cord + a ball between two pipe ends. */
function FreeJoint({
  joint,
  selectable,
  ball,
  onContext,
}: {
  joint: Joint;
  selectable: boolean;
  ball: string;
  onContext?: (e: ThreeEvent<MouseEvent>) => void;
}) {
  const design = useAppStore.getState().current;
  if (!design) return null;
  const eased = (id: string): Vec3 =>
    easedPos(id) ?? nodeById(design, id)?.position ?? { x: 0, y: 0, z: 0 };
  const receiver = memberById(design, joint.receiver);
  const mover = memberById(design, joint.mover);
  if (!receiver || !mover) return null;
  const node = eased(joint.nodeId);

  const odMax = Math.max(pipeSpec(receiver.size).odM, pipeSpec(mover.size).odM);
  const ballR = odMax * 0.55;
  const eyeR = odMax * 0.42;

  // an eye-bolt end + cord for each pipe that actually ENDS at the joint: always
  // the mover; the receiver too when its own end butts here (end-to-end). For an
  // on-body branch the receiver instead gets a saddle eye bolt clamped on the run.
  const eyeEnds = (joint.onBody ? [mover] : [receiver, mover]).map((m) => {
    const far = m.nodeA === joint.nodeId ? m.nodeB : m.nodeA;
    const dir = normalize(sub(eased(far), node));
    return { end: add(node, scale(dir, FREE_JOINT_GAP_M)), dir };
  });

  // on-body: the run's own direction, for orienting the saddle clamp ring
  const runDir = joint.onBody ? normalize(sub(eased(receiver.nodeB), eased(receiver.nodeA))) : null;
  const saddleR = pipeSpec(receiver.size).odM * 0.72;

  const onSelect = selectable
    ? (e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        useEditorStore.getState().selectJoint(joint.id);
      }
    : undefined;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: r3f group is a scene node
    <group onClick={onSelect} onContextMenu={onContext}>
      {eyeEnds.map((e, i) => {
        const cord = placeAxis(e.end, node);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: ≤2 ends, positional
          <group key={i}>
            {/* eye-bolt ring at the pipe end */}
            <mesh position={[e.end.x, e.end.y, e.end.z]} quaternion={orientZ(e.dir)}>
              <torusGeometry args={[eyeR, eyeR * 0.28, 12, 20]} />
              <meshStandardMaterial color={EYE_COLOR} roughness={0.35} metalness={0.85} />
            </mesh>
            {/* knotted cord from the eye to the ball */}
            {cord && (
              <mesh position={cord.mid} quaternion={cord.quat}>
                <cylinderGeometry args={[odMax * 0.09, odMax * 0.09, cord.len, 8]} />
                <meshStandardMaterial color={CORD_COLOR} roughness={0.9} metalness={0} />
              </mesh>
            )}
          </group>
        );
      })}
      {/* on-body: a saddle eye bolt clamped around the run at the joint */}
      {runDir && (
        <mesh position={[node.x, node.y, node.z]} quaternion={orientZ(runDir)}>
          <torusGeometry args={[saddleR, saddleR * 0.22, 12, 24]} />
          <meshStandardMaterial color={EYE_COLOR} roughness={0.35} metalness={0.85} />
        </mesh>
      )}
      {/* the ball at the joint */}
      <mesh position={[node.x, node.y, node.z]} castShadow>
        <sphereGeometry args={[ballR, 20, 16]} />
        <meshPhysicalMaterial color={ball} roughness={0.3} metalness={0.1} clearcoat={0.6} />
      </mesh>
    </group>
  );
}

export function JointLayer() {
  useAnim((s) => s.v); // re-render while easing so joints track the pipe
  const design = useAppStore((s) => s.current);
  const tool = useEditorStore((s) => s.tool);
  const selectedJointId = useEditorStore((s) => s.selectedJointId);
  const night = useThemeStore((s) => s.night);
  if (!design || design.members.length > MAX_JOINT_MEMBERS) return null;
  const pal = scenePalette(night);
  const editing = tool === 'select' || tool === 'move' || tool === 'rotate';
  const selectable = tool === 'select';
  // a joint is a first-class selectable — selecting it highlights the hardware
  // ONLY (not the pipe), and swap/switch acts on it while it stays selected
  const isSelected = (j: Joint) => selectedJointId === j.id;
  const selectedJoint = design.joints.find((j) => j.id === selectedJointId);
  const swapNode =
    selectable && selectedJoint && !selectedJoint.onBody
      ? (easedPos(selectedJoint.nodeId) ?? nodeById(design, selectedJoint.nodeId)?.position)
      : undefined;
  // right-clicking the joint hardware (the collar / ball) re-opens its menu —
  // the pipe ends are pulled back at a free pivot, so the pipe alone can't catch
  // a click on the ball. Uses the joint's own node + mover (not a raycast guess).
  const onContext = (j: Joint) =>
    editing
      ? (e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          const ne = e.nativeEvent as MouseEvent;
          useEditorStore
            .getState()
            .openJoinMenu({ nodeId: j.nodeId, moverId: j.mover, x: ne.clientX, y: ne.clientY });
        }
      : undefined;

  return (
    <>
      {design.joints.map((j) => {
        if (j.mode === 'free')
          return (
            <FreeJoint
              key={j.id}
              joint={j}
              selectable={selectable}
              ball={pal.accent}
              onContext={onContext(j)}
            />
          );
        // rigid 90° union → a standard socket tee; other angles → the wrap arrow
        if (anchorRendersAsTee(design, j))
          return (
            <AnchorTee
              key={j.id}
              joint={j}
              selectable={selectable}
              selected={isSelected(j)}
              fitting={pal.fitting}
              onContext={onContext(j)}
            />
          );
        return (
          <WrapJoint
            key={j.id}
            joint={j}
            selectable={selectable}
            selected={isSelected(j)}
            onContext={onContext(j)}
          />
        );
      })}
      {/* floating switch gizmo next to a selected end-to-end joint: swaps which
          pipe wraps/receives which, keeping the joint selected */}
      {swapNode && selectedJoint && (
        <Html position={[swapNode.x, swapNode.y, swapNode.z]} center zIndexRange={[60, 0]}>
          <button
            type="button"
            title="Swap which pipe wraps which"
            aria-label="Swap joint receiver"
            onClick={(e) => {
              e.stopPropagation();
              swapJointReceiver(selectedJoint.id);
            }}
            style={{ transform: 'translate(20px, -20px)' }}
            className="flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-md hover:bg-accent"
          >
            <ArrowLeftRight size={13} />
          </button>
        </Html>
      )}
    </>
  );
}
