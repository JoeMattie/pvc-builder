// r3f renderer for the pipe model. Pipe BODIES are drawn as a single
// InstancedMesh of unit cylinders (one draw call for the whole run) whose
// transforms are refreshed imperatively each frame from the eased render
// positions — so a dense model (hundreds of pipes) neither pays hundreds of draw
// calls nor re-reconciles React every animation frame. Selection is a per-
// instance colour; all interactions (select / context / bend / double-click to
// draw) resolve the member from the ray's instanceId. Hollow end bores and the
// end-cap ghost stay declarative (few) in <PipeDecorations/>.
import { type ThreeEvent, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Color, type InstancedMesh, Matrix4, Raycaster, Vector2, Vector3 } from 'three';
import { endCapAllowanceM } from '../../design/bom';
import {
  groupColorOf,
  groupOfMember,
  incidentMembers,
  memberById,
  nodeById,
} from '../../design/docOps';
import { add, dot, length, normalize, scale, sub } from '../../geometry/math3';
import { pipeSpec, type Vec3 } from '../../schema';
import { easedPos } from '../../state/animStore';
import { useAppStore } from '../../state/appStore';
import { bendMemberAt, enterGroup, placeDrawPoint, selectMember } from '../../state/editorActions';
import { useEditorStore } from '../../state/editorStore';
import { useThemeStore } from '../../state/themeStore';
import { scenePalette } from '../theme';
import { dominantAxisNormal, rayToPlane } from './ground';
import {
  cylinderMatrix,
  GROUP_DIM_ALPHA,
  hideMatrix,
  instanceAlphaPatch,
  ringMatrix,
  setInstanceAlphas,
} from './instancing';
import { startWindowPointerDrag } from './interactions';
import { buildPipeModel } from './pipeModel';
import { pickSnapPoint, SNAP_PX } from './pipePick';
import { canOpenRightClickMenu, recordPointerDebug } from './rightClickGesture';

const RADIAL_SEGMENTS = 20;
const SELECT_BLUE = '#2a78d6';

/** Instanced pipe bodies — self-contained: reads the stores + camera it needs,
 * updates instance transforms in useFrame, and routes pointer interactions via
 * the ray's instanceId. */
function InstancedPipes() {
  const design = useAppStore((s) => s.current);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const tool = useEditorStore((s) => s.tool);
  const drawingFrom = useEditorStore((s) => s.drawingFromNodeId);
  const enteredGroupId = useEditorStore((s) => s.enteredGroupId);
  const night = useThemeStore((s) => s.night);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null;
  const rc = useMemo(() => new Raycaster(), []);
  const ndc = useMemo(() => new Vector2(), []);
  const fwd = useMemo(() => new Vector3(), []);
  const meshRef = useRef<InstancedMesh>(null);
  const hoverClear = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mat = useRef(new Matrix4()).current;

  // structural (doc-position) model: fixes the instance order + count +
  // instanceId→memberId map; recomputed only when the design changes
  const structural = useMemo(() => (design ? buildPipeModel(design) : null), [design]);
  const count = structural?.cylinders.length ?? 0;
  const color = scenePalette(night).pvc;
  // when a group is ENTERED, only its members are interactive; the rest fade
  const activeSet = useMemo(() => {
    if (!enteredGroupId || !design) return null;
    const g = design.groups.find((gr) => gr.id === enteredGroupId);
    return g ? new Set(g.memberIds) : null;
  }, [design, enteredGroupId]);
  const inactive = (id: string | undefined): boolean => !!activeSet && (!id || !activeSet.has(id));

  // refresh every instance transform from the eased positions, each frame
  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh || !design) return;
    const model = buildPipeModel(design, easedPos);
    for (let i = 0; i < count; i++) {
      const c = model.cylinders[i];
      if (c && cylinderMatrix(mat, c.a, c.b, c.radiusM)) mesh.setMatrixAt(i, mat);
      else {
        hideMatrix(mat);
        mesh.setMatrixAt(i, mat);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  // per-instance colour: white PVC (theme), a subtle per-group cast, or select-
  // blue. Outside an entered group a pipe keeps its colour but GHOSTS via a
  // per-instance alpha (semi-transparent, not grayed). Set on change only.
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || !structural || !design) return;
    const selected = new Set(selectedIds);
    const base = new Color(color);
    const sel = new Color(SELECT_BLUE);
    // memberId → its group's colour cast (base lerped 60% toward it — strong
    // enough to tell groups apart at a glance)
    const tint = new Map<string, Color>();
    for (const g of design.groups) {
      const gc = new Color(color).lerp(new Color(groupColorOf(design, g.id)), 0.6);
      for (const id of g.memberIds) tint.set(id, gc);
    }
    for (let i = 0; i < structural.cylinders.length; i++) {
      const cyl = structural.cylinders[i];
      if (!cyl) continue;
      const dim = activeSet && !activeSet.has(cyl.memberId);
      const c = !dim && selected.has(cyl.memberId) ? sel : (tint.get(cyl.memberId) ?? base);
      mesh.setColorAt(i, c);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    setInstanceAlphas(mesh, (i) => {
      const id = structural.cylinders[i]?.memberId;
      return activeSet && (!id || !activeSet.has(id)) ? GROUP_DIM_ALPHA : 1;
    });
  }, [structural, selectedIds, color, activeSet, design]);

  useEffect(
    () => () => {
      if (hoverClear.current) clearTimeout(hoverClear.current);
    },
    [],
  );

  if (!design || !structural || count === 0) return null;

  const editing = tool === 'select' || tool === 'move' || tool === 'rotate' || tool === 'extend';
  const semanticHover = tool === 'select' || tool === 'move' || tool === 'rotate';
  const memberOf = (ev: { instanceId?: number | null }): string | undefined =>
    ev.instanceId == null ? undefined : structural.cylinders[ev.instanceId]?.memberId;
  const clearHoverLater = () => {
    if (hoverClear.current) clearTimeout(hoverClear.current);
    hoverClear.current = setTimeout(() => {
      hoverClear.current = null; // fired — don't hold a stale handle
      const store = useEditorStore.getState();
      if (store.hoveredSceneItem?.kind === 'member') {
        recordPointerDebug('hover-clear', { target: 'pipe', id: store.hoveredSceneItem.id });
        store.setHoveredSceneItem(null);
      }
    }, 80);
  };
  const keepHover = () => {
    if (!hoverClear.current) return;
    clearTimeout(hoverClear.current);
    hoverClear.current = null;
  };

  // click-to-select in select / move / rotate (pick a pipe without leaving the gizmo)
  const onClick = editing
    ? (ev: ThreeEvent<MouseEvent>) => {
        const id = memberOf(ev);
        if (!id || inactive(id)) return; // faded (non-entered-group) pipes are inert
        ev.stopPropagation();
        selectMember(id);
      }
    : undefined;

  // right-click: a genuine multi-pipe junction (near an end) opens the join
  // selector; anywhere else opens the size switcher for the pipe / multi-select
  const onMenuPointerUp =
    editing && !drawingFrom
      ? (ev: ThreeEvent<PointerEvent>) => {
          if (ev.nativeEvent.button !== 2) return;
          const memberId = memberOf(ev);
          if (!memberId || inactive(memberId)) return;
          ev.stopPropagation();
          const ne = ev.nativeEvent;
          if (!canOpenRightClickMenu(ne.pointerId, 'pipe', ne.clientX, ne.clientY)) return;
          const store = useEditorStore.getState();
          const m = memberById(design, memberId);
          if (m?.kind === 'straight') {
            const pa = nodeById(design, m.nodeA)?.position;
            const pb = nodeById(design, m.nodeB)?.position;
            if (pa && pb) {
              const snap = pickSnapPoint(
                camera,
                gl.domElement,
                design,
                ne.clientX,
                ne.clientY,
                SNAP_PX * 3,
                {
                  nodes: true,
                  pipes: false,
                },
              );
              if (
                snap?.kind === 'node' &&
                (snap.id === m.nodeA || snap.id === m.nodeB) &&
                incidentMembers(design, snap.id).length >= 2
              ) {
                recordPointerDebug('menu-open', {
                  pointerId: ne.pointerId,
                  x: ne.clientX,
                  y: ne.clientY,
                  target: 'pipe-join-snap',
                  id: memberId,
                });
                store.openJoinMenu({
                  nodeId: snap.id,
                  moverId: memberId,
                  x: ne.clientX,
                  y: ne.clientY,
                });
                return;
              }
              const nearA = length(sub(ev.point, pa)) <= length(sub(ev.point, pb));
              const nodeId = nearA ? m.nodeA : m.nodeB;
              const endPos = nearA ? pa : pb;
              const endZone = 0.25 * length(sub(pa, pb));
              if (
                length(sub(ev.point, endPos)) < endZone &&
                incidentMembers(design, nodeId).length >= 2
              ) {
                recordPointerDebug('menu-open', {
                  pointerId: ne.pointerId,
                  x: ne.clientX,
                  y: ne.clientY,
                  target: 'pipe-join',
                  id: memberId,
                });
                store.openJoinMenu({ nodeId, moverId: memberId, x: ne.clientX, y: ne.clientY });
                return;
              }
            }
          }
          const sel = store.selectedIds;
          const memberIds = sel.includes(memberId) && sel.length > 1 ? sel : [memberId];
          recordPointerDebug('menu-open', {
            pointerId: ne.pointerId,
            x: ne.clientX,
            y: ne.clientY,
            target: 'pipe-size',
            id: memberId,
          });
          store.openSizeMenu({ memberIds, x: ne.clientX, y: ne.clientY });
        }
      : undefined;

  // double-click (select tool) → start drawing a new pipe from the clicked point
  const onDoubleClick =
    tool === 'select' && !drawingFrom
      ? (ev: ThreeEvent<MouseEvent>) => {
          if (ev.instanceId == null) return;
          ev.stopPropagation();
          // double-clicking a grouped pipe ENTERS its group (not draw); an
          // ungrouped pipe (or one already inside the entered group) starts a draw
          const memberId = structural.cylinders[ev.instanceId]?.memberId;
          if (inactive(memberId)) return; // faded pipes ignore double-click too
          const g = memberId ? groupOfMember(design, memberId) : undefined;
          const entered = useEditorStore.getState().enteredGroupId;
          if (g && g.id !== entered) {
            enterGroup(g.id);
            return;
          }
          useEditorStore.getState().setTool('draw');
          placeDrawPoint(ev.point);
        }
      : undefined;

  // Bend tool: press+drag a pipe to bend it (rides a view-facing plane through
  // the grab point; window listeners keep the drag alive off the mesh)
  const onPointerDown =
    tool === 'bend'
      ? (ev: ThreeEvent<PointerEvent>) => {
          if (ev.nativeEvent.button !== 0) return;
          const memberId =
            ev.instanceId == null ? undefined : structural.cylinders[ev.instanceId]?.memberId;
          if (!memberId || inactive(memberId)) return;
          const m = memberById(design, memberId);
          if (!m) return;
          const a = easedPos(m.nodeA) ?? nodeById(design, m.nodeA)?.position;
          const b = easedPos(m.nodeB) ?? nodeById(design, m.nodeB)?.position;
          if (!a || !b) return;
          ev.stopPropagation();
          const axis = sub(b, a);
          const len2 = dot(axis, axis);
          const gp = { x: ev.point.x, y: ev.point.y, z: ev.point.z };
          const t = len2 > 1e-9 ? Math.max(0, Math.min(1, dot(sub(gp, a), axis) / len2)) : 0.5;
          const grab = add(a, scale(axis, t));
          const axisLen = Math.sqrt(len2);
          const lengthRef =
            axisLen > 1e-6 ? { axisDir: scale(axis, 1 / axisLen), lengthM: axisLen } : undefined;
          camera.getWorldDirection(fwd);
          const normal = dominantAxisNormal({ x: fwd.x, y: fwd.y, z: fwd.z });
          if (controls) controls.enabled = false;
          useAppStore.getState().beginGesture();
          const el = gl.domElement;
          const move = (e: PointerEvent) => {
            const rect = el.getBoundingClientRect();
            ndc.set(
              ((e.clientX - rect.left) / rect.width) * 2 - 1,
              -((e.clientY - rect.top) / rect.height) * 2 + 1,
            );
            rc.setFromCamera(ndc, camera);
            const cur = rayToPlane(rc.ray, grab, normal);
            if (cur) bendMemberAt(memberId, t, sub(cur, grab), lengthRef);
          };
          const up = () => {
            if (controls) controls.enabled = true;
            useAppStore.getState().endGesture();
          };
          startWindowPointerDrag({ onMove: move, onUp: up, onCancel: up });
        }
      : undefined;

  const onPointerMove = semanticHover
    ? (ev: ThreeEvent<PointerEvent>) => {
        const id =
          ev.instanceId == null ? undefined : structural.cylinders[ev.instanceId]?.memberId;
        const store = useEditorStore.getState();
        if (!id || inactive(id)) {
          if (store.hoveredSceneItem?.kind === 'member') clearHoverLater();
          return;
        }
        ev.stopPropagation();
        keepHover();
        if (store.hoveredSceneItem?.kind !== 'member' || store.hoveredSceneItem.id !== id)
          recordPointerDebug('hover-member', { target: 'pipe', id });
        store.setHoveredSceneItem({ kind: 'member', id });
      }
    : undefined;
  const onPointerOut = semanticHover
    ? () => {
        clearHoverLater();
      }
    : undefined;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: r3f mesh is a three.js scene node, not a DOM element
    <instancedMesh
      // key on count so a structural change reallocates the instance buffers
      key={count}
      ref={meshRef}
      args={[undefined, undefined, count]}
      frustumCulled={false}
      castShadow
      receiveShadow
      onClick={onClick}
      onPointerUp={onMenuPointerUp}
      onDoubleClick={onDoubleClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerOut={onPointerOut}
    >
      <cylinderGeometry args={[1, 1, 1, RADIAL_SEGMENTS]} />
      <meshPhysicalMaterial
        color="#ffffff"
        roughness={0.38}
        metalness={0}
        clearcoat={0.6}
        clearcoatRoughness={0.35}
        onBeforeCompile={instanceAlphaPatch}
      />
    </instancedMesh>
  );
}

/** Hollow end bores + the end-cap ghosts, each as one InstancedMesh with
 * imperative per-frame transforms (no anim-tick re-render). */
function PipeDecorations() {
  const design = useAppStore((s) => s.current);
  const night = useThemeStore((s) => s.night);
  const enteredGroupId = useEditorStore((s) => s.enteredGroupId);
  const boreRef = useRef<InstancedMesh>(null);
  const capRef = useRef<InstancedMesh>(null);
  const mat = useRef(new Matrix4()).current;

  // structural spec (recompute only on design change) fixes the instance
  // buffers + the instance → node/member maps used for group ghosting
  const counts = useMemo(() => {
    if (!design)
      return { bores: 0, caps: 0, boreNodes: [] as string[], capMembers: [] as string[] };
    const at = (id: string) => nodeById(design, id)?.position;
    const ends = buildPipeModel(design).ends;
    const caps = ghostCaps(design, at);
    return {
      bores: ends.length,
      caps: caps.length,
      boreNodes: ends.map((e) => e.nodeId),
      capMembers: caps.map((c) => c.memberId),
    };
  }, [design]);

  // ghost the decorations of everything OUTSIDE an entered group (per-instance
  // alpha; recomputed on enter/exit only)
  useEffect(() => {
    if (!design) return;
    const g = enteredGroupId ? design.groups.find((gr) => gr.id === enteredGroupId) : undefined;
    const active = g ? new Set(g.memberIds) : null;
    const nodeDim = (nodeId: string | undefined): boolean =>
      !!active && (!nodeId || incidentMembers(design, nodeId).every((m) => !active.has(m.id)));
    if (boreRef.current)
      setInstanceAlphas(boreRef.current, (i) =>
        nodeDim(counts.boreNodes[i]) ? GROUP_DIM_ALPHA : 1,
      );
    if (capRef.current)
      setInstanceAlphas(
        capRef.current,
        (i) => {
          const id = counts.capMembers[i];
          return active && (!id || !active.has(id)) ? GROUP_DIM_ALPHA : 1;
        },
        { keepTransparent: true }, // the cap ghost is transparent by design
      );
  }, [design, enteredGroupId, counts]);

  useFrame(() => {
    if (!design) return;
    const at = (id: string): Vec3 | undefined => easedPos(id) ?? nodeById(design, id)?.position;
    const bore = boreRef.current;
    if (bore) {
      const ends = buildPipeModel(design, easedPos).ends;
      for (let i = 0; i < counts.bores; i++) {
        const e = ends[i];
        if (e) {
          const inner = Math.max(e.odM / 2 - e.wallM, 0.001);
          // sit the disc just outside the end face so the cylinder cap doesn't hide it
          const c = {
            x: e.center.x + e.dir.x * 0.0004,
            y: e.center.y + e.dir.y * 0.0004,
            z: e.center.z + e.dir.z * 0.0004,
          };
          ringMatrix(mat, c, e.dir, inner);
        } else hideMatrix(mat);
        bore.setMatrixAt(i, mat);
      }
      bore.instanceMatrix.needsUpdate = true;
    }
    const cap = capRef.current;
    if (cap) {
      const caps = ghostCaps(design, at);
      for (let i = 0; i < counts.caps; i++) {
        const g = caps[i];
        if (!g || !cylinderMatrix(mat, g.a, g.b, g.r)) hideMatrix(mat);
        cap.setMatrixAt(i, mat);
      }
      cap.instanceMatrix.needsUpdate = true;
    }
  });

  if (!design) return null;
  return (
    <>
      {counts.bores > 0 && (
        <instancedMesh
          key={`bore-${counts.bores}`}
          ref={boreRef}
          args={[undefined, undefined, counts.bores]}
          frustumCulled={false}
        >
          <circleGeometry args={[1, 24]} />
          <meshStandardMaterial
            color={night ? '#0c0e12' : '#3a3d44'}
            roughness={0.9}
            side={2}
            onBeforeCompile={instanceAlphaPatch}
          />
        </instancedMesh>
      )}
      {counts.caps > 0 && (
        <instancedMesh
          key={`cap-${counts.caps}`}
          ref={capRef}
          args={[undefined, undefined, counts.caps]}
          frustumCulled={false}
        >
          <cylinderGeometry args={[1, 1, 1, RADIAL_SEGMENTS]} />
          <meshBasicMaterial
            color="#2a78d6"
            transparent
            opacity={0.22}
            onBeforeCompile={instanceAlphaPatch}
          />
        </instancedMesh>
      )}
    </>
  );
}

/** GHOST end-cap extensions (BOM: a wrapped pipe END is cut 1" + 1 radius longer
 * for an end cap) — a translucent stub past the receiver's end; real geometry is
 * unchanged. Pure so both the structural count and the per-frame fill share it. */
function ghostCaps(
  design: NonNullable<ReturnType<typeof useAppStore.getState>['current']>,
  at: (id: string) => Vec3 | undefined,
): Array<{ a: Vec3; b: Vec3; r: number; memberId: string }> {
  return design.joints.flatMap((j) => {
    if (j.mode !== 'wrapped') return [];
    const recv = memberById(design, j.receiver);
    if (recv?.kind !== 'straight' || (recv.nodeA !== j.nodeId && recv.nodeB !== j.nodeId))
      return [];
    const endPos = at(j.nodeId);
    const otherPos = at(recv.nodeA === j.nodeId ? recv.nodeB : recv.nodeA);
    if (!endPos || !otherPos) return [];
    const d = sub(endPos, otherPos);
    if (length(d) < 1e-9) return [];
    const dir = normalize(d);
    return [
      {
        a: endPos,
        b: add(endPos, scale(dir, endCapAllowanceM(recv.size))),
        r: pipeSpec(recv.size).odM / 2,
        memberId: recv.id,
      },
    ];
  });
}

/** Renders the current design's pipe: instanced bodies + instanced end
 * decorations (hollow bores + end-cap ghosts). */
export function PipeLayer() {
  return (
    <>
      <InstancedPipes />
      <PipeDecorations />
    </>
  );
}
