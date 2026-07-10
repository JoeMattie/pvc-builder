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
import { GROUP_DIM_ALPHA } from './instancing';
import { anchorRendersAsHub, anchorRendersAsTee } from './jointStyle';
import { FREE_JOINT_GAP_M, WRAP_END_GAP_M } from './pipeModel';
import { canOpenRightClickMenu, recordPointerDebug } from './rightClickGesture';
import { buildWrapArrow } from './wrapArrow';

const MAX_JOINT_MEMBERS = 800;
const CORD_COLOR = '#c9b48a'; // knotted natural cord
const EYE_COLOR = '#6b7280'; // galvanised eye bolt
const WRAP_GREEN = '#2fa84f'; // swivel arrow (can rotate)
const RIGID_STEEL = '#8b9099'; // rigid loop (locked)
const PIN_HEAD = '#d64545'; // locking pin head
const PIN_SHAFT = '#b9bec6';
const SELECT_BLUE = '#2a78d6';
const HUB_BROWN = '#8a5a33'; // fabricated many-way union (heat-wrapped + screwed)

/** A rigid on-body union at ~90°: a standard socket TEE sleeving the run + branch
 * (the branch pipe runs full into the hub — see pipeModel). White PVC, matching
 * the auto-resolved fittings. */
function AnchorTee({
  joint,
  selectable,
  selected,
  dimmed,
  fitting,
  onMenuPointerUp,
  onHover,
  onHoverOut,
}: {
  joint: Joint;
  selectable: boolean;
  selected: boolean;
  dimmed: boolean;
  fitting: string;
  onMenuPointerUp?: (e: ThreeEvent<PointerEvent>) => void;
  onHover?: (e: ThreeEvent<PointerEvent>) => void;
  onHoverOut?: () => void;
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

  const color = selected && !dimmed ? SELECT_BLUE : fitting;
  const onSelect =
    selectable && !dimmed
      ? (e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          useEditorStore.getState().selectJoint(joint.id);
        }
      : undefined;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: r3f group is a scene node
    <group
      onClick={onSelect}
      onPointerUp={dimmed ? undefined : onMenuPointerUp}
      onPointerMove={dimmed ? undefined : onHover}
      onPointerOut={dimmed ? undefined : onHoverOut}
    >
      {mesh.prims.map((p, i) =>
        p.kind === 'cylinder' ? (
          <TeeCyl
            // biome-ignore lint/suspicious/noArrayIndexKey: primitives are positional per fitting
            key={i}
            c={p}
            color={color}
            dimmed={dimmed}
          />
        ) : (
          <mesh
            // biome-ignore lint/suspicious/noArrayIndexKey: primitives are positional per fitting
            key={i}
            position={[p.center.x, p.center.y, p.center.z]}
            castShadow
          >
            <sphereGeometry args={[p.radiusM, 18, 14]} />
            <meshPhysicalMaterial
              // key: three bakes an OPAQUE define into non-transparent programs
              // (forces alpha 1) — remount the material when the flag flips
              key={dimmed ? 'dim' : 'solid'}
              color={color}
              roughness={0.5}
              metalness={0}
              clearcoat={0.4}
              transparent={dimmed}
              opacity={dimmed ? GROUP_DIM_ALPHA : 1}
            />
          </mesh>
        ),
      )}
    </group>
  );
}

function TeeCyl({ c, color, dimmed }: { c: FittingCyl; color: string; dimmed: boolean }) {
  const placed = placeAxis(c.a, c.b);
  if (!placed) return null;
  return (
    <mesh position={placed.mid} quaternion={placed.quat} castShadow>
      <cylinderGeometry args={[c.radiusM, c.radiusM, placed.len, 18]} />
      <meshPhysicalMaterial
        key={dimmed ? 'dim' : 'solid'} // remount on flip: OPAQUE define, see AnchorTee
        color={color}
        roughness={0.5}
        metalness={0}
        clearcoat={0.4}
        transparent={dimmed}
        opacity={dimmed ? GROUP_DIM_ALPHA : 1}
      />
    </mesh>
  );
}

/** A fabricated MANY-WAY union: more pipe ends enter the point than any
 * standard fitting has sockets (a solved X / 3-way / 4-way crossing), so the
 * whole anchor cluster at the node draws as ONE brown wrap ball — heat-wrapped
 * and screwed on site. Clickable like any joint hardware: click selects the
 * cluster's primary joint; right-click opens its join menu. */
function FabricatedHub({
  joints,
  selectable,
  selected,
  dimmed,
  onMenuPointerUp,
  onHover,
  onHoverOut,
}: {
  /** every anchor joint at this node (the first is the primary/selected one) */
  joints: Joint[];
  selectable: boolean;
  selected: boolean;
  dimmed: boolean;
  onMenuPointerUp?: (e: ThreeEvent<PointerEvent>) => void;
  onHover?: (e: ThreeEvent<PointerEvent>) => void;
  onHoverOut?: () => void;
}) {
  const design = useAppStore.getState().current;
  const primary = joints[0];
  if (!design || !primary) return null;
  const node = easedPos(primary.nodeId) ??
    nodeById(design, primary.nodeId)?.position ?? { x: 0, y: 0, z: 0 };

  // the largest pipe OD entering the junction sizes the wrap ball
  let odMax = 0;
  for (const m of design.members) {
    if (m.nodeA === primary.nodeId || m.nodeB === primary.nodeId)
      odMax = Math.max(odMax, pipeSpec(m.size).odM);
  }
  for (const j of joints) {
    const recv = memberById(design, j.receiver);
    if (recv) odMax = Math.max(odMax, pipeSpec(recv.size).odM);
  }
  if (odMax <= 0) return null;
  const radius = odMax * 0.75;

  const color = selected && !dimmed ? SELECT_BLUE : HUB_BROWN;
  const onSelect =
    selectable && !dimmed
      ? (e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          useEditorStore.getState().selectJoint(primary.id);
        }
      : undefined;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: r3f group is a scene node
    <group
      onClick={onSelect}
      onPointerUp={dimmed ? undefined : onMenuPointerUp}
      onPointerMove={dimmed ? undefined : onHover}
      onPointerOut={dimmed ? undefined : onHoverOut}
    >
      <mesh position={[node.x, node.y, node.z]} castShadow>
        <sphereGeometry args={[radius, 24, 18]} />
        <meshPhysicalMaterial
          key={dimmed ? 'dim' : 'solid'} // remount on flip: OPAQUE define, see AnchorTee
          color={color}
          roughness={0.55}
          metalness={0}
          clearcoat={0.35}
          transparent={dimmed}
          opacity={dimmed ? GROUP_DIM_ALPHA : 1}
        />
      </mesh>
    </group>
  );
}

/** A wrapped pivot (swivel arrow) or an on-body rigid union (pinned loop). */
function WrapJoint({
  joint,
  selectable,
  selected,
  dimmed,
  onMenuPointerUp,
  onHover,
  onHoverOut,
}: {
  joint: Joint;
  selectable: boolean;
  selected: boolean;
  dimmed: boolean;
  onMenuPointerUp?: (e: ThreeEvent<PointerEvent>) => void;
  onHover?: (e: ThreeEvent<PointerEvent>) => void;
  onHoverOut?: () => void;
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

  const bodyColor = selected && !dimmed ? SELECT_BLUE : rigid ? RIGID_STEEL : WRAP_GREEN;
  const onSelect =
    selectable && !dimmed
      ? (e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          useEditorStore.getState().selectJoint(joint.id);
        }
      : undefined;
  // spread WITH key={dimmed ? 'dim' : 'solid'}: the key remounts the material on
  // the flip — three bakes an OPAQUE define (alpha forced to 1) into programs
  // compiled while transparent=false, so the flag can't just be toggled
  const dimProps = { transparent: dimmed, opacity: dimmed ? GROUP_DIM_ALPHA : 1 };

  const headH = Math.max(arrow.tubeR * 4.5, 0.014);
  const headR = arrow.tubeR * 2.6;
  const pinLen = Math.max(arrow.tubeR * 8, 0.022);
  const pinHeadR = Math.max(arrow.tubeR * 3.2, 0.006);
  const pinMid = add(arrow.pinBase, scale(arrow.pinDir, pinLen / 2));
  const pinTop = add(arrow.pinBase, scale(arrow.pinDir, pinLen));

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: r3f group is a scene node
    <group
      onClick={onSelect}
      onPointerUp={dimmed ? undefined : onMenuPointerUp}
      onPointerMove={dimmed ? undefined : onHover}
      onPointerOut={dimmed ? undefined : onHoverOut}
    >
      {/* the loop body swept once around the run */}
      <mesh castShadow>
        <tubeGeometry args={[curve, 72, arrow.tubeR, 8, false]} />
        <meshStandardMaterial
          color={bodyColor}
          roughness={0.5}
          metalness={rigid ? 0.5 : 0.1}
          key={dimmed ? 'dim' : 'solid'}
          {...dimProps}
        />
      </mesh>
      {rigid ? (
        // locking pin: a shaft driven into the run + a round head
        <group>
          <mesh position={[pinMid.x, pinMid.y, pinMid.z]} quaternion={orientY(arrow.pinDir)}>
            <cylinderGeometry args={[arrow.tubeR * 0.8, arrow.tubeR * 0.8, pinLen, 12]} />
            <meshStandardMaterial
              color={PIN_SHAFT}
              roughness={0.35}
              metalness={0.85}
              key={dimmed ? 'dim' : 'solid'}
              {...dimProps}
            />
          </mesh>
          <mesh position={[pinTop.x, pinTop.y, pinTop.z]} castShadow>
            <sphereGeometry args={[pinHeadR, 16, 12]} />
            <meshStandardMaterial
              color={selected && !dimmed ? SELECT_BLUE : PIN_HEAD}
              roughness={0.4}
              key={dimmed ? 'dim' : 'solid'}
              {...dimProps}
            />
          </mesh>
        </group>
      ) : (
        // arrowhead closing the loop (the swivel direction)
        <mesh position={[arrow.tip.x, arrow.tip.y, arrow.tip.z]} quaternion={orientY(arrow.tipDir)}>
          <coneGeometry args={[headR, headH, 16]} />
          <meshStandardMaterial
            color={bodyColor}
            roughness={0.5}
            metalness={0.1}
            key={dimmed ? 'dim' : 'solid'}
            {...dimProps}
          />
        </mesh>
      )}
    </group>
  );
}

/** A free (ball) pivot: eye bolts + knotted cord + a ball between two pipe ends. */
function FreeJoint({
  joint,
  selectable,
  dimmed,
  ball,
  onMenuPointerUp,
  onHover,
  onHoverOut,
}: {
  joint: Joint;
  selectable: boolean;
  dimmed: boolean;
  ball: string;
  onMenuPointerUp?: (e: ThreeEvent<PointerEvent>) => void;
  onHover?: (e: ThreeEvent<PointerEvent>) => void;
  onHoverOut?: () => void;
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

  const onSelect =
    selectable && !dimmed
      ? (e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          useEditorStore.getState().selectJoint(joint.id);
        }
      : undefined;
  // spread WITH key={dimmed ? 'dim' : 'solid'}: the key remounts the material on
  // the flip — three bakes an OPAQUE define (alpha forced to 1) into programs
  // compiled while transparent=false, so the flag can't just be toggled
  const dimProps = { transparent: dimmed, opacity: dimmed ? GROUP_DIM_ALPHA : 1 };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: r3f group is a scene node
    <group
      onClick={onSelect}
      onPointerUp={dimmed ? undefined : onMenuPointerUp}
      onPointerMove={dimmed ? undefined : onHover}
      onPointerOut={dimmed ? undefined : onHoverOut}
    >
      {eyeEnds.map((e, i) => {
        const cord = placeAxis(e.end, node);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: ≤2 ends, positional
          <group key={i}>
            {/* eye-bolt ring at the pipe end */}
            <mesh position={[e.end.x, e.end.y, e.end.z]} quaternion={orientZ(e.dir)}>
              <torusGeometry args={[eyeR, eyeR * 0.28, 12, 20]} />
              <meshStandardMaterial
                color={EYE_COLOR}
                roughness={0.35}
                metalness={0.85}
                key={dimmed ? 'dim' : 'solid'}
                {...dimProps}
              />
            </mesh>
            {/* knotted cord from the eye to the ball */}
            {cord && (
              <mesh position={cord.mid} quaternion={cord.quat}>
                <cylinderGeometry args={[odMax * 0.09, odMax * 0.09, cord.len, 8]} />
                <meshStandardMaterial
                  color={CORD_COLOR}
                  roughness={0.9}
                  metalness={0}
                  key={dimmed ? 'dim' : 'solid'}
                  {...dimProps}
                />
              </mesh>
            )}
          </group>
        );
      })}
      {/* on-body: a saddle eye bolt clamped around the run at the joint */}
      {runDir && (
        <mesh position={[node.x, node.y, node.z]} quaternion={orientZ(runDir)}>
          <torusGeometry args={[saddleR, saddleR * 0.22, 12, 24]} />
          <meshStandardMaterial
            color={EYE_COLOR}
            roughness={0.35}
            metalness={0.85}
            key={dimmed ? 'dim' : 'solid'}
            {...dimProps}
          />
        </mesh>
      )}
      {/* the ball at the joint */}
      <mesh position={[node.x, node.y, node.z]} castShadow>
        <sphereGeometry args={[ballR, 20, 16]} />
        <meshPhysicalMaterial
          color={ball}
          roughness={0.3}
          metalness={0.1}
          clearcoat={0.6}
          key={dimmed ? 'dim' : 'solid'}
          {...dimProps}
        />
      </mesh>
    </group>
  );
}

export function JointLayer() {
  useAnim((s) => s.v); // re-render while easing so joints track the pipe
  const design = useAppStore((s) => s.current);
  const tool = useEditorStore((s) => s.tool);
  const selectedJointId = useEditorStore((s) => s.selectedJointId);
  const enteredGroupId = useEditorStore((s) => s.enteredGroupId);
  const night = useThemeStore((s) => s.night);
  if (!design || design.members.length > MAX_JOINT_MEMBERS) return null;
  const pal = scenePalette(night);
  // while a group is entered, a joint whose members are ALL outside it GHOSTS
  // (semi-transparent, matching the instanced layers) and goes inert
  const enteredGroup = enteredGroupId
    ? design.groups.find((gr) => gr.id === enteredGroupId)
    : undefined;
  const activeSet = enteredGroup ? new Set(enteredGroup.memberIds) : null;
  const isDimmed = (j: Joint): boolean =>
    !!activeSet && !activeSet.has(j.receiver) && !activeSet.has(j.mover);
  const editing = tool === 'select' || tool === 'move' || tool === 'rotate';
  const selectable = tool === 'select';
  // a joint is a first-class selectable — selecting it highlights the hardware
  // ONLY (not the pipe), and swap/switch acts on it while it stays selected
  const isSelected = (j: Joint) => selectedJointId === j.id;
  const selectedJoint = design.joints.find((j) => j.id === selectedJointId);
  // the swap gizmo only makes sense for a WRAPPED end-to-end pivot ("which pipe
  // wraps which") — not for a free ball or a rigid tee
  const swapNode =
    selectable && selectedJoint && !selectedJoint.onBody && selectedJoint.mode === 'wrapped'
      ? (easedPos(selectedJoint.nodeId) ?? nodeById(design, selectedJoint.nodeId)?.position)
      : undefined;
  // right-clicking the joint hardware (the collar / ball) re-opens its menu —
  // the pipe ends are pulled back at a free pivot, so the pipe alone can't catch
  // a click on the ball. Uses the joint's own node + mover (not a raycast guess).
  const onMenuPointerUp = (j: Joint) =>
    editing
      ? (e: ThreeEvent<PointerEvent>) => {
          if (e.nativeEvent.button !== 2) return;
          e.stopPropagation();
          const ne = e.nativeEvent;
          if (!canOpenRightClickMenu(ne.pointerId, 'joint', ne.clientX, ne.clientY)) return;
          recordPointerDebug('menu-open', {
            pointerId: ne.pointerId,
            x: ne.clientX,
            y: ne.clientY,
            target: 'joint',
            id: j.id,
          });
          useEditorStore
            .getState()
            .openJoinMenu({ nodeId: j.nodeId, moverId: j.mover, x: ne.clientX, y: ne.clientY });
        }
      : undefined;
  const onHover = (j: Joint) =>
    editing
      ? (e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          useEditorStore.getState().setHoveredSceneItem({ kind: 'joint', id: j.id });
        }
      : undefined;
  const onHoverOut = () => {
    const store = useEditorStore.getState();
    if (store.hoveredSceneItem?.kind === 'joint') store.setHoveredSceneItem(null);
  };

  // anchor joints at a many-way junction (>3 pipe ends — beyond any standard
  // fitting) collapse into ONE brown fabricated-union sphere per NODE
  const hubAnchors = new Map<string, Joint[]>();
  for (const j of design.joints) {
    if (j.mode !== 'anchor' || !anchorRendersAsHub(design, j)) continue;
    const list = hubAnchors.get(j.nodeId);
    if (list) list.push(j);
    else hubAnchors.set(j.nodeId, [j]);
  }

  return (
    <>
      {design.joints.map((j) => {
        // end-to-end frees → InstancedFreeHubs; wrapped (swivel) → InstancedWrapJoints
        if (j.mode === 'free' && !j.onBody) return null;
        if (j.mode === 'wrapped') return null;
        // a many-way anchor cluster renders once, as the fabricated hub sphere
        const hub = j.mode === 'anchor' ? hubAnchors.get(j.nodeId) : undefined;
        if (hub) {
          if (hub[0]!.id !== j.id) return null; // one sphere per node
          return (
            <FabricatedHub
              key={j.id}
              joints={hub}
              selectable={selectable}
              selected={hub.some(isSelected)}
              dimmed={hub.every(isDimmed)}
              onMenuPointerUp={onMenuPointerUp(j)}
              onHover={onHover(j)}
              onHoverOut={onHoverOut}
            />
          );
        }
        if (j.mode === 'free')
          return (
            <FreeJoint
              key={j.id}
              joint={j}
              selectable={selectable}
              dimmed={isDimmed(j)}
              ball={pal.accent}
              onMenuPointerUp={onMenuPointerUp(j)}
              onHover={onHover(j)}
              onHoverOut={onHoverOut}
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
              dimmed={isDimmed(j)}
              fitting={pal.fitting}
              onMenuPointerUp={onMenuPointerUp(j)}
              onHover={onHover(j)}
              onHoverOut={onHoverOut}
            />
          );
        return (
          <WrapJoint
            key={j.id}
            joint={j}
            selectable={selectable}
            selected={isSelected(j)}
            dimmed={isDimmed(j)}
            onMenuPointerUp={onMenuPointerUp(j)}
            onHover={onHover(j)}
            onHoverOut={onHoverOut}
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
            // down-right of the node: the joint label pill renders ABOVE it,
            // and up-right parked this button on top of the label text
            style={{ transform: 'translate(22px, 24px)' }}
            className="flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-md hover:bg-accent"
          >
            <ArrowLeftRight size={13} />
          </button>
        </Html>
      )}
    </>
  );
}
