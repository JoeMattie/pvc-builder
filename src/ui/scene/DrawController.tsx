import { Html, Line } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useThree } from '@react-three/fiber';
import { useMemo, useState } from 'react';
import { CatmullRomCurve3, type Ray, Raycaster, Vector2, Vector3 } from 'three';
import { attachmentPos, incidentMembers, memberById, nodeById } from '../../design/docOps';
import { closestAxisPointToRay } from '../../design/dragMath';
import { guideDrawSpan, perpOffsetM } from '../../design/guides';
import { marqueeFromDrag, memberSelectedBy, type Pt } from '../../design/marquee';
import type { SnapResult } from '../../design/snapping';
import { add, dot, length, scale, sub } from '../../geometry/math3';
import { type Member, pipeSpec, type Vec3 } from '../../schema';
import { easedPos } from '../../state/animStore';
import { useAppStore } from '../../state/appStore';
import {
  clearSelection,
  pickGuideRef,
  placeDrawPoint,
  placeElasticPoint,
  placeFormedPoint,
  placeGuide,
  placeMeasurePoint,
  setSelectionGroupAware,
  snapDrawPoint,
  snapFormedPoint,
  snapMeasurePoint,
  updateMeasureOffset,
} from '../../state/editorActions';
import { useEditorStore } from '../../state/editorStore';
import { useThemeStore } from '../../state/themeStore';
import { GROUND_SIZE_M, scenePalette } from '../theme';
import { formatLengthDisplay } from '../units';
import { placeAxis } from './axis';
import { dominantAxisNormal, rayToGround, rayToPlane } from './ground';
import { CLICK_SLOP_PX, startWindowPointerDrag } from './interactions';
import { pickSnapPoint, SNAP_PX, snapDebug } from './pipePick';

const AXIS_COLOR = { x: '#d64545', y: '#3d9950', z: '#2a78d6' } as const;
const SNAP_GREEN = '#12b886'; // snap indicator (dot / pill / pipe outline)

/** A translucent bright outline sleeve over a pipe the cursor is snapping to. */
function OutlineCyl({ a, b, r }: { a: Vec3; b: Vec3; r: number }) {
  const placed = placeAxis(a, b);
  if (!placed) return null;
  return (
    <mesh position={placed.mid} quaternion={placed.quat}>
      <cylinderGeometry args={[r, r, placed.len, 16]} />
      <meshBasicMaterial color={SNAP_GREEN} transparent opacity={0.28} />
    </mesh>
  );
}

/** Snap feedback: a dot at the snap point, a small "End" / "On Pipe" pill, and
 * an outline around the pipe(s) being snapped TO (planfile draw-mode snapping). */
function SnapHint({ preview, night }: { preview: SnapResult; night: boolean }) {
  const design = useAppStore.getState().current;
  const label =
    preview.kind === 'guide'
      ? 'Guide intersection'
      : preview.kind === 'node'
        ? 'End'
        : preview.kind === 'on-pipe'
          ? 'On Pipe'
          : null;
  if (!design || !label) return null;
  const at = (id: string): Vec3 | undefined => easedPos(id) ?? nodeById(design, id)?.position;
  const outlines: { a: Vec3; b: Vec3; r: number }[] = [];
  const addMember = (memberId: string) => {
    const m = memberById(design, memberId);
    if (m?.kind !== 'straight') return;
    const a = at(m.nodeA);
    const b = at(m.nodeB);
    if (a && b) outlines.push({ a, b, r: (pipeSpec(m.size).odM / 2) * 1.6 });
  };
  if (preview.kind === 'on-pipe' && preview.onPipeMemberId) addMember(preview.onPipeMemberId);
  else if (preview.kind === 'node' && preview.nodeId) {
    for (const m of design.members) {
      if (m.nodeA === preview.nodeId || m.nodeB === preview.nodeId) addMember(m.id);
    }
  }
  const pos = preview.position;
  return (
    <>
      <mesh position={[pos.x, pos.y, pos.z]}>
        <sphereGeometry args={[0.013, 12, 10]} />
        <meshBasicMaterial color={SNAP_GREEN} />
      </mesh>
      {outlines.map((o, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: positional per snap frame
        <OutlineCyl key={i} a={o.a} b={o.b} r={o.r} />
      ))}
      <Html position={[pos.x, pos.y, pos.z]} center zIndexRange={[100, 0]}>
        <div
          style={{
            padding: '1px 6px',
            borderRadius: 6,
            font: "600 11px 'IBM Plex Sans', sans-serif",
            background: SNAP_GREEN,
            color: '#fff',
            border: `1px solid ${night ? '#0c8a63' : '#0ea371'}`,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            transform: 'translate(14px, 12px)',
          }}
        >
          {label}
        </div>
      </Html>
    </>
  );
}

export function DrawController() {
  const tool = useEditorStore((s) => s.tool);
  const drawSize = useEditorStore((s) => s.drawSize);
  const drawingFromNodeId = useEditorStore((s) => s.drawingFromNodeId);
  const night = useThemeStore((s) => s.night);
  // Narrow selectors instead of subscribing to the whole document: while a
  // node is being dragged in the select tool, `drawingFromNodeId` is null, so
  // fromPos stays `undefined` and the document churn doesn't re-render this.
  const fromPos = useAppStore((s) =>
    s.current && drawingFromNodeId ? nodeById(s.current, drawingFromNodeId)?.position : undefined,
  );
  const lengthDisplay = useAppStore((s) => s.current?.lengthDisplay);
  const formedPoints = useEditorStore((s) => s.formedPoints);
  const drawLength = useEditorStore((s) => s.drawLength);
  const measureFrom = useEditorStore((s) => s.measureFrom);
  const elasticFrom = useEditorStore((s) => s.elasticFrom);
  const guideDraft = useEditorStore((s) => s.guideDraft);
  const guideLength = useEditorStore((s) => s.guideLength);
  const guideCursor = useEditorStore((s) => s.guideCursor);
  const setGuideCursor = useEditorStore((s) => s.setGuideCursor);
  const [preview, setPreview] = useState<SnapResult | null>(null);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const fwd = useMemo(() => new Vector3(), []);
  const rc = useMemo(() => new Raycaster(), []);
  const ndc = useMemo(() => new Vector2(), []);

  const odR = pipeSpec(drawSize).odM / 2;

  // The point being extended from (the previous path point). When present, the
  // pointer rides a view-facing plane through it (3D drawing: draw up a wall in a
  // side view, Shift-lock to any axis incl. Y), matching how endpoint drags work.
  // The FIRST point of a path has no `from`, so it lands on the y = 0 ground.
  const extendDrawing = tool === 'extend' && !!fromPos;
  const drawLike = tool === 'draw' || extendDrawing;

  const fromPoint = (): Vec3 | undefined => {
    if (drawLike) return fromPos;
    if (tool === 'formed' && formedPoints.length) return formedPoints[formedPoints.length - 1];
    return undefined;
  };
  // Screen-space snap: the node / pipe the cursor is visually over (any height),
  // or null. Screen-space — NOT a 3D ray-distance test, which snaps to any pipe
  // the ray grazes in depth, firing "beyond" the pipe on screen.
  const snapUnderCursor = (cx: number, cy: number) => {
    const snap = useEditorStore.getState().snap;
    const design = useAppStore.getState().current;
    if (!design) return null;
    return pickSnapPoint(camera, gl.domElement, design, cx, cy, SNAP_PX, {
      excludeNode: useEditorStore.getState().drawingFromNodeId ?? undefined,
      nodes: snap.snapToEnds,
      pipes: snap.snapToPipes,
    });
  };

  // Shift-lock: the point on whichever WORLD axis line (X/Y/Z through `from`) the
  // picking ray passes closest to — so Shift constrains to Y as well as X/Z. A
  // ground/plane projection can't reach Y; projecting the ray onto each axis line
  // can (same closest-point-on-axis trick the move gizmo + length arrow use).
  const axisLockPoint = (from: Vec3, ray: Ray): Vec3 => {
    const o = { x: ray.origin.x, y: ray.origin.y, z: ray.origin.z };
    const d = { x: ray.direction.x, y: ray.direction.y, z: ray.direction.z };
    const AXES: Vec3[] = [
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
    ];
    let best: { p: Vec3; dist: number } | null = null;
    for (const ax of AXES) {
      const p = closestAxisPointToRay(from, ax, o, d);
      const t = dot(sub(p, o), d) / (dot(d, d) || 1);
      const dist = length(sub(p, add(o, scale(d, t)))); // ray-line ↔ axis-line gap
      if (!best || dist < best.dist) best = { p, dist };
    }
    return best?.p ?? from;
  };

  const targetOf = (ray: Ray, cx: number, cy: number, lockAxis = false): Vec3 | null => {
    // Shift held mid-path → lock to a world axis line (incl. Y); overrides snapping
    const from0 = fromPoint();
    if (lockAxis && from0) return axisLockPoint(from0, ray);
    // hovering an existing node/pipe (any height) → the 3D point on it, so
    // snapPoint resolves a node/on-pipe/tee snap instead of a ground point below
    const hit = snapUnderCursor(cx, cy);
    if (snapDebug()) {
      const d = useAppStore.getState().current;
      console.log(
        '[snap]',
        hit ? `${hit.kind} ${hit.id} @${hit.distPx.toFixed(1)}px` : 'none',
        hit?.point,
        `members=${d?.members.length ?? 0}`,
      );
    }
    if (hit) return hit.point;
    if (!from0) return rayToGround(ray);
    camera.getWorldDirection(fwd);
    return (
      rayToPlane(ray, from0, dominantAxisNormal({ x: fwd.x, y: fwd.y, z: fwd.z })) ??
      rayToGround(ray)
    );
  };

  // Project a world point to client (screen) px — for the marquee hit-test.
  const screenTmp = useMemo(() => new Vector3(), []);
  const projectToScreen = (w: Vec3): Pt => {
    const rect = gl.domElement.getBoundingClientRect();
    const v = screenTmp.set(w.x, w.y, w.z).project(camera);
    return {
      x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-v.y * 0.5 + 0.5) * rect.height,
    };
  };
  const memberScreenPts = (m: Member): Pt[] => {
    const design = useAppStore.getState().current;
    if (!design) return [];
    const at = (id: string): Vec3 | undefined => easedPos(id) ?? nodeById(design, id)?.position;
    const a = at(m.nodeA);
    const b = at(m.nodeB);
    if (!a || !b) return [];
    const worlds = m.kind === 'formed' ? [a, ...m.controlPoints, b] : [a, b];
    return worlds.map(projectToScreen);
  };

  // A world point from raw client coords (window events carry no r3f ray).
  const targetFromClient = (clientX: number, clientY: number, lockAxis = false): Vec3 | null => {
    const rect = gl.domElement.getBoundingClientRect();
    ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    rc.setFromCamera(ndc, camera);
    return targetOf(rc.ray, clientX, clientY, lockAxis);
  };

  // hover preview between clicks (mesh event is fine when no button is down)
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    if (e.nativeEvent.buttons !== 0) return; // a press drives its own window move
    const g = targetOf(e.ray, e.nativeEvent.clientX, e.nativeEvent.clientY, e.nativeEvent.shiftKey);
    if (!g) return;
    if (tool === 'guide') {
      setGuideCursor(g);
      return;
    }
    if (drawLike) {
      const snap = snapDrawPoint(g, e.nativeEvent.shiftKey);
      setPreview(snap);
      // record the aim direction so a typed length can be committed along it
      if (fromPos) {
        const d = sub(snap.position, fromPos);
        useEditorStore.getState().setDrawDirection(length(d) > 1e-6 ? d : null);
      }
    } else if (tool === 'formed') setPreview(snapFormedPoint(g));
    else if (tool === 'measure') {
      if (useEditorStore.getState().measureAdjustId) updateMeasureOffset(g);
      else setPreview(snapMeasurePoint(g));
    } else if (tool === 'elastic') setPreview(snapMeasurePoint(g));
  };

  // The press+release is driven by WINDOW listeners, not the mesh's own
  // pointerup — r3f drops the mesh pointerup once a drag moves the ray, the same
  // reason the handle drags use window listeners (see useGroundDrag).
  const onDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.nativeEvent.button !== 0) return; // left only; middle pans, right rotates
    const startX = e.nativeEvent.clientX;
    const startY = e.nativeEvent.clientY;
    const liveTool = useEditorStore.getState().tool;
    // click+drag: press places the first point; a path already open just waits
    let startedPath = false;
    if (liveTool === 'draw' && !useEditorStore.getState().drawingFromNodeId) {
      const g = targetOf(
        e.ray,
        e.nativeEvent.clientX,
        e.nativeEvent.clientY,
        e.nativeEvent.shiftKey,
      );
      if (g) {
        setPreview(placeDrawPoint(g, e.nativeEvent.shiftKey));
        startedPath = true;
      }
    }
    // tape measure: press places the first end (click-drag), unless mid-sequence
    let startedMeasure = false;
    if (liveTool === 'measure') {
      const ms = useEditorStore.getState();
      if (!ms.measureFrom && !ms.measureAdjustId) {
        const g = targetOf(
          e.ray,
          e.nativeEvent.clientX,
          e.nativeEvent.clientY,
          e.nativeEvent.shiftKey,
        );
        if (g) {
          placeMeasurePoint(g);
          startedMeasure = true;
        }
      }
    }
    // elastic band: press places the first attachment (click-drag), unless
    // mid-sequence (waiting for the 2nd click)
    let startedElastic = false;
    if (liveTool === 'elastic' && !useEditorStore.getState().elasticFrom) {
      const g = targetOf(
        e.ray,
        e.nativeEvent.clientX,
        e.nativeEvent.clientY,
        e.nativeEvent.shiftKey,
      );
      if (g) {
        placeElasticPoint(g);
        startedElastic = true;
      }
    }
    // guide tool: the FIRST press picks the reference pipe under the cursor; the
    // second click (pointerup, below) drops the parallel guide
    let startedGuide = false;
    if (liveTool === 'guide' && !useEditorStore.getState().guideDraft) {
      const hit = snapUnderCursor(e.nativeEvent.clientX, e.nativeEvent.clientY);
      if (hit) {
        const design = useAppStore.getState().current;
        const memberId =
          hit.kind === 'pipe'
            ? hit.id
            : design
              ? incidentMembers(design, hit.id).find((m) => m.kind === 'straight')?.id
              : undefined;
        if (memberId) {
          pickGuideRef(memberId, hit.point);
          startedGuide = true;
        }
      }
    }
    // any non-drawing tool marquee-selects on an empty-canvas drag; move/rotate
    // additionally switch to the select tool so the drag reads as a selection
    const liveDrawLike =
      liveTool === 'draw' ||
      (liveTool === 'extend' && !!useEditorStore.getState().drawingFromNodeId);
    const nonDrawing =
      !liveDrawLike &&
      liveTool !== 'formed' &&
      liveTool !== 'measure' &&
      liveTool !== 'elastic' &&
      liveTool !== 'guide';
    const move = (ev: PointerEvent) => {
      if (liveTool === 'guide') {
        const g = targetFromClient(ev.clientX, ev.clientY);
        if (g) setGuideCursor(g);
        return;
      }
      if (nonDrawing) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > CLICK_SLOP_PX) {
          if (useEditorStore.getState().tool !== 'select')
            useEditorStore.getState().setTool('select');
          useEditorStore
            .getState()
            .setMarquee({ x0: startX, y0: startY, x1: ev.clientX, y1: ev.clientY });
        }
        return;
      }
      const g = targetFromClient(ev.clientX, ev.clientY, ev.shiftKey);
      if (!g) return;
      if (liveDrawLike) setPreview(snapDrawPoint(g, ev.shiftKey));
      else if (liveTool === 'formed') setPreview(snapFormedPoint(g));
      else if (liveTool === 'measure') {
        if (useEditorStore.getState().measureAdjustId) updateMeasureOffset(g);
        else setPreview(snapMeasurePoint(g));
      } else if (liveTool === 'elastic') setPreview(snapMeasurePoint(g));
    };
    const up = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      const moved = Math.hypot(ev.clientX - startX, ev.clientY - startY);
      if (liveTool === 'guide') {
        // a click while positioning commits the guide; the pick-click doesn't
        if (useEditorStore.getState().guideDraft && !startedGuide) {
          const g = targetFromClient(ev.clientX, ev.clientY);
          if (g) placeGuide(g);
        }
        return;
      }
      if (nonDrawing) {
        if (moved > CLICK_SLOP_PX) {
          // rubber-band: left→right = contained, right→left = touching (CAD)
          const { rect, mode } = marqueeFromDrag(startX, startY, ev.clientX, ev.clientY);
          const design = useAppStore.getState().current;
          if (design) {
            const hits = design.members
              .filter((m) => memberSelectedBy(memberScreenPts(m), rect, mode))
              .map((m) => m.id);
            setSelectionGroupAware(hits);
          }
        } else {
          // a plain click on empty space clears the selection (a pipe click
          // re-selects afterwards — its onClick fires after this window up)
          clearSelection();
        }
        useEditorStore.getState().setMarquee(null);
        return;
      }
      const g = targetFromClient(ev.clientX, ev.clientY, ev.shiftKey);
      if (!g) return;
      if (liveDrawLike) {
        // a drag ends the segment; a click that didn't start the path extends it
        // (two-click); a click that started the path leaves it open for click 2
        if (moved > CLICK_SLOP_PX || !startedPath) setPreview(placeDrawPoint(g, ev.shiftKey));
      } else if (moved <= CLICK_SLOP_PX && liveTool === 'formed') {
        setPreview(placeFormedPoint(g));
      } else if (liveTool === 'measure') {
        // a drag places the 2nd end; a two-click sequence places it on the 2nd
        // click; a click during offset-adjust confirms it (placeMeasurePoint reads
        // the phase from state)
        if (moved > CLICK_SLOP_PX || !startedMeasure) placeMeasurePoint(g);
      } else if (liveTool === 'elastic') {
        // a drag places the 2nd end; a two-click sequence places it on click 2
        if (moved > CLICK_SLOP_PX || !startedElastic) placeElasticPoint(g);
      }
    };
    startWindowPointerDrag({ onMove: move, onUp: up, onCancel: up });
  };

  const showPreview = drawLike && preview;
  // formed preview: a spline through the committed points + the cursor
  const formedPreview =
    tool === 'formed' && preview
      ? [...formedPoints, preview.position].map((p) => new Vector3(p.x, p.y, p.z))
      : null;
  const p = preview?.position;
  const guide = preview?.guide;
  const segLen = fromPos && p ? length(sub(p, fromPos)) : 0;
  const ghost = fromPos && p ? placeAxis(fromPos, p) : null;

  return (
    <>
      {/* subtle FINITE ground fill (40 ft) so the horizon reads distinct from the
          sky. Sits well below y=0 (past the deepest pipe radius) so a pipe lying
          on the ground isn't clipped in half by an opaque plane at the centreline. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.03, 0]}>
        <planeGeometry args={[GROUND_SIZE_M, GROUND_SIZE_M]} />
        <meshBasicMaterial color={scenePalette(night).ground} />
      </mesh>
      {/* invisible pointer target + shadow catcher at y=0 — larger than the visible
          ground so drawing/orbiting past the ground edge still works */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        onPointerMove={onMove}
        onPointerDown={onDown}
      >
        <planeGeometry args={[200, 200]} />
        <shadowMaterial transparent opacity={night ? 0.35 : 0.2} />
      </mesh>

      {/* snap indicator (dot + End/On Pipe pill + outline) for draw + formed + measure + elastic */}
      {(drawLike || tool === 'formed' || tool === 'measure' || tool === 'elastic') && preview && (
        <SnapHint preview={preview} night={night} />
      )}

      {/* elastic-band rubber band: first attachment → cursor (orange, like a band) */}
      {tool === 'elastic' &&
        elasticFrom &&
        preview &&
        (() => {
          const design = useAppStore.getState().current;
          const a = design ? attachmentPos(design, elasticFrom) : undefined;
          if (!a) return null;
          const b = preview.position;
          return (
            <>
              <Line
                points={[
                  [a.x, a.y, a.z],
                  [b.x, b.y, b.z],
                ]}
                color="#f76707"
                lineWidth={2}
                dashed
                dashSize={0.03}
                gapSize={0.02}
              />
              <mesh position={[a.x, a.y, a.z]}>
                <sphereGeometry args={[0.012, 12, 10]} />
                <meshBasicMaterial color="#f76707" />
              </mesh>
            </>
          );
        })()}

      {/* tape-measure rubber band: first end → cursor */}
      {tool === 'measure' &&
        measureFrom &&
        preview &&
        (() => {
          const design = useAppStore.getState().current;
          const a =
            'nodeId' in measureFrom
              ? design
                ? nodeById(design, measureFrom.nodeId)?.position
                : undefined
              : measureFrom.position;
          if (!a) return null;
          const b = preview.position;
          return (
            <>
              <Line
                points={[
                  [a.x, a.y, a.z],
                  [b.x, b.y, b.z],
                ]}
                color="#e08a00"
                lineWidth={1.75}
                dashed
                dashSize={0.04}
                gapSize={0.03}
              />
              <mesh position={[a.x, a.y, a.z]}>
                <sphereGeometry args={[0.012, 12, 10]} />
                <meshBasicMaterial color="#e08a00" />
              </mesh>
            </>
          );
        })()}

      {/* guide-line placement preview: a parallel axis-snapped line through the
          cursor + the perpendicular-offset distance (live-typable) */}
      {tool === 'guide' &&
        guideDraft &&
        guideCursor &&
        (() => {
          const g = { id: '', origin: guideCursor, dir: guideDraft.dir };
          const [s0, s1] = guideDrawSpan(g);
          const axis: 'x' | 'y' | 'z' =
            guideDraft.dir.x === 1 ? 'x' : guideDraft.dir.y === 1 ? 'y' : 'z';
          const off = perpOffsetM(guideDraft.refOrigin, guideDraft.dir, guideCursor);
          return (
            <>
              <Line
                points={[
                  [s0.x, s0.y, s0.z],
                  [s1.x, s1.y, s1.z],
                ]}
                color={AXIS_COLOR[axis]}
                lineWidth={1.5}
                dashed
                dashSize={0.04}
                gapSize={0.03}
              />
              <Html position={[guideCursor.x, guideCursor.y, guideCursor.z]} center>
                <div
                  style={{
                    padding: '2px 6px',
                    borderRadius: 6,
                    font: "500 12px 'IBM Plex Mono', monospace",
                    background: night ? '#1e2128' : '#fff',
                    color: night ? '#e8eaf0' : '#1a1d24',
                    border: `1px solid ${guideLength ? '#2a78d6' : night ? '#33363f' : '#e4e4e7'}`,
                    boxShadow: guideLength ? '0 0 0 2px rgba(42,120,214,0.35)' : 'none',
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none',
                    transform: 'translate(14px, -14px)',
                  }}
                >
                  {guideLength ? `${guideLength}▏` : formatLengthDisplay(off, lengthDisplay)}
                </div>
              </Html>
            </>
          );
        })()}

      {showPreview && p && (
        <>
          {/* pen marker — small + partially transparent */}
          <mesh position={[p.x, p.y, p.z]}>
            <sphereGeometry args={[Math.max(odR * 0.95, 0.01), 16, 12]} />
            <meshBasicMaterial color="#2a78d6" transparent opacity={0.55} />
          </mesh>

          {/* ghost of the segment about to be drawn + its length label */}
          {ghost && (
            <>
              <mesh position={ghost.mid} quaternion={ghost.quat}>
                <cylinderGeometry args={[odR, odR, ghost.len, 16]} />
                <meshStandardMaterial color="#2a78d6" transparent opacity={0.3} roughness={0.5} />
              </mesh>
              {/* fixed screen-size label pinned to the segment midpoint — NO
                  distanceFactor, so it stays readable at any zoom (that scale
                  makes it balloon when zoomed in) */}
              <Html
                position={[ghost.mid.x, ghost.mid.y, ghost.mid.z]}
                center
                zIndexRange={[100, 0]}
              >
                <div
                  style={{
                    padding: '2px 6px',
                    borderRadius: 6,
                    font: "500 12px 'IBM Plex Mono', monospace",
                    background: night ? '#1e2128' : '#fff',
                    color: night ? '#e8eaf0' : '#1a1d24',
                    // active typed-length input gets a blue ring
                    border: `1px solid ${drawLength ? '#2a78d6' : night ? '#33363f' : '#e4e4e7'}`,
                    boxShadow: drawLength ? '0 0 0 2px rgba(42,120,214,0.35)' : 'none',
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none',
                    transform: 'translateY(-14px)',
                  }}
                >
                  {drawLength ? `${drawLength}▏` : formatLengthDisplay(segLen, lengthDisplay)}
                </div>
              </Html>
            </>
          )}

          {/* axis inference guide */}
          {guide && (
            <Line
              points={[
                [guide.from.x, guide.from.y, guide.from.z] as [number, number, number],
                [guide.to.x, guide.to.y, guide.to.z] as [number, number, number],
              ]}
              color={AXIS_COLOR[guide.axis]}
              lineWidth={1.5}
              dashed
              dashSize={0.03}
              gapSize={0.02}
            />
          )}
        </>
      )}

      {/* formed (heat-bent) preview: committed markers + a ghost spline tube */}
      {tool === 'formed' && (
        <>
          {formedPoints.map((cp) => (
            <mesh key={`${cp.x},${cp.y},${cp.z}`} position={[cp.x, cp.y, cp.z]}>
              <sphereGeometry args={[Math.max(odR * 0.95, 0.01), 14, 10]} />
              <meshBasicMaterial color="#2a78d6" transparent opacity={0.75} />
            </mesh>
          ))}
          {p && (
            <mesh position={[p.x, p.y, p.z]}>
              <sphereGeometry args={[Math.max(odR * 0.95, 0.01), 14, 10]} />
              <meshBasicMaterial color="#2a78d6" transparent opacity={0.55} />
            </mesh>
          )}
          {formedPreview && formedPreview.length >= 2 && (
            <mesh>
              <tubeGeometry
                args={[
                  new CatmullRomCurve3(formedPreview, false, 'catmullrom', 0.5),
                  Math.max(24, formedPreview.length * 20),
                  odR,
                  12,
                  false,
                ]}
              />
              <meshStandardMaterial color="#2a78d6" transparent opacity={0.3} roughness={0.5} />
            </mesh>
          )}
        </>
      )}
    </>
  );
}
