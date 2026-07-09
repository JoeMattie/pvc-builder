import {
  GizmoHelper,
  GizmoViewport,
  Grid,
  OrbitControls,
  OrthographicCamera,
  PerspectiveCamera,
} from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { MOUSE, Vector3 } from 'three';
import { nodeById } from '../../design/docOps';
import { marqueeFromDrag, memberSelectedBy, type Pt } from '../../design/marquee';
import type { Vec3 } from '../../schema';
import { solve } from '../../solver';
import {
  activeTopoHash,
  physicsActive,
  physicsNodePositions,
  physicsTopoHash,
  simGroundY,
  startPhysics,
  stepPhysics,
  stopPhysics,
} from '../../solver/physics';
import { bumpAnim, easedPos, stepEasing } from '../../state/animStore';
import { useAppStore } from '../../state/appStore';
import {
  getCameraPose,
  getPoseVersion,
  orthoInit,
  PERSP_FOV,
  perspInit,
  recordPose,
  type V3,
} from '../../state/cameraStore';
import {
  jointOrientationsOf,
  pivotAnglesOf,
  setSelectionGroupAware,
} from '../../state/editorActions';
import { useEditorStore } from '../../state/editorStore';
import { useThemeStore } from '../../state/themeStore';
import { GROUND_SIZE_M, scenePalette } from '../theme';
import { DrawController } from './DrawController';
import { FittingLayer } from './FittingLayer';
import { FormedLayer } from './FormedLayer';
import { InstancedFreeHubs } from './InstancedFreeHubs';
import { InstancedWrapJoints } from './InstancedWrapJoints';
import { IntersectionLayer } from './IntersectionLayer';
import { JointLayer } from './JointLayer';
import { MeasureLayer } from './MeasureLayer';
import { PhysicsDebug } from './PhysicsDebug';
import { PipeLayer } from './PipeLayer';
import { MoveGizmo, RotateGizmo, SelectionHandles } from './SelectionHandles';

/** The infinite reference grid. Sits at the design ground (y=0) normally; during
 * a physics run it drops to the sim floor (just below the model) so pipes rest on
 * the visible grid instead of sinking below it, and resets when the sim stops.
 * Subscribes only to `simulating` (reads the frozen doc non-reactively), so a
 * drag never re-renders the grid. */
function GroundGrid({ pal }: { pal: ReturnType<typeof scenePalette> }) {
  const simulating = useEditorStore((s) => s.simulating);
  const design = simulating ? useAppStore.getState().current : null;
  const groundY = design ? simGroundY(design) : 0;
  return (
    <group position={[0, groundY, 0]}>
      <Grid
        // finite ground (20 ft), not an infinite grid; lines on integer inches:
        // minor every 4", major every 12" (1 ft), aligned to the origin
        args={[GROUND_SIZE_M, GROUND_SIZE_M]}
        cellSize={4 * 0.0254}
        cellThickness={0.6}
        cellColor={pal.gridCell}
        sectionSize={12 * 0.0254}
        sectionThickness={1}
        sectionColor={pal.gridSection}
        fadeDistance={30}
        fadeStrength={1.5}
        followCamera={false}
      />
    </group>
  );
}

/** Everything inside the Canvas: camera, studio lighting, ground grid + shadow
 * catcher, pipe meshes, the draw controller, and selection drag handles. */
export function Scene() {
  // Scene deliberately does NOT subscribe to the design document — the pipe and
  // handle layers read it themselves. That keeps a drag (which mutates the doc
  // every frame) from re-rendering the grid, gizmo, cameras, and lights.
  const projection = useEditorStore((s) => s.projection);
  const tool = useEditorStore((s) => s.tool);
  const night = useThemeStore((s) => s.night);
  const pal = scenePalette(night);
  // Viewport pixel height, to match ortho zoom ⇄ perspective distance on toggle.
  // Only changes on resize, so this doesn't re-render during a drag.
  const viewportH = useThree((s) => s.size.height);

  return (
    <>
      <color attach="background" args={[pal.viewport]} />

      {projection === 'ortho' ? (
        <OrthographicCamera makeDefault {...orthoInit()} near={-100} far={100} />
      ) : (
        <PerspectiveCamera
          makeDefault
          {...perspInit(viewportH)}
          fov={PERSP_FOV}
          near={0.01}
          far={1000}
        />
      )}

      <ambientLight intensity={0.65} />
      <hemisphereLight intensity={0.35} />
      {/* soft shadows: PCFSoftShadowMap (Canvas shadows="soft") + a blur radius
          gives a gentle penumbra instead of a hard edge. A big map keeps the
          softened edge from looking blocky. */}
      <directionalLight
        position={[6, 12, 8]}
        intensity={1.15}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-radius={6}
        shadow-bias={-0.0002}
        shadow-normalBias={0.02}
        shadow-camera-left={-4}
        shadow-camera-right={4}
        shadow-camera-top={4}
        shadow-camera-bottom={-4}
        shadow-camera-near={0.1}
        shadow-camera-far={40}
      />

      <GroundGrid pal={pal} />

      <PipeLayer />
      <FormedLayer />
      <FittingLayer />
      <JointLayer />
      <InstancedFreeHubs />
      <InstancedWrapJoints />
      <IntersectionLayer />
      <MeasureLayer />

      {/* ground-plane pointer target + shadow catcher + draw preview */}
      <DrawController />

      {/* endpoint drag handles for the selected member */}
      {tool === 'select' && <SelectionHandles />}
      {/* move-tool translate gizmo / rotate-tool ring gizmo on the selection */}
      {tool === 'move' && <MoveGizmo />}
      {tool === 'rotate' && <RotateGizmo />}

      {/* middle = pan, right = free rotate; left is reserved (drawing / select
          / future marquee), so it never orbits. `key={projection}` remounts the
          controls onto the new default camera on toggle; the target comes from
          the shared pose so the view doesn't reset. */}
      <OrbitControls
        key={projection}
        makeDefault
        enableDamping
        zoomToCursor
        target={getCameraPose().target}
        mouseButtons={{ MIDDLE: MOUSE.PAN, RIGHT: MOUSE.ROTATE }}
      />
      <CameraPoseSync />
      <ViewController />

      <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
        <GizmoViewport axisColors={['#d64545', '#3d9950', '#2a78d6']} labelColor="#fff" />
      </GizmoHelper>

      <GeometryAnimator />
      <PhysicsDebug />
      <VelocityZoom />
      <DebugBridge />
    </>
  );
}

/** Velocity-aware wheel zoom: scale OrbitControls' per-tick zoom step by how
 * fast the wheel is spinning, so a quick flick covers ground while a slow
 * scroll stays fine. Runs in the capture phase so the updated zoomSpeed is in
 * place before OrbitControls handles the same wheel event. */
function VelocityZoom() {
  const gl = useThree((s) => s.gl);
  const controls = useThree((s) => s.controls) as { zoomSpeed: number } | null;
  useEffect(() => {
    if (!controls) return;
    const el = gl.domElement;
    const BASE = controls.zoomSpeed;
    let last = performance.now();
    let vel = 0; // smoothed wheel magnitude per ms
    const onWheel = (e: WheelEvent) => {
      const now = performance.now();
      const dt = Math.max(1, now - last);
      last = now;
      // fade prior velocity over ~130 ms, then add this tick's instantaneous
      // speed (bigger/faster deltas ⇒ more) so rapid flicks accumulate
      vel = vel * Math.exp(-dt / 130) + Math.abs(e.deltaY) / dt;
      controls.zoomSpeed = Math.min(5, Math.max(0.6, 0.7 + vel * 0.9));
    };
    el.addEventListener('wheel', onWheel, { passive: true, capture: true });
    return () => {
      el.removeEventListener('wheel', onWheel, { capture: true } as EventListenerOptions);
      controls.zoomSpeed = BASE;
    };
  }, [gl, controls]);
  return null;
}

/** Records the live camera pose (position / target / zoom) into cameraStore on
 * every OrbitControls change, so a projection toggle — which remounts the
 * camera + controls — can restore the same view instead of snapping back to the
 * default isometric framing. Mirrors VelocityZoom's `useThree(s => s.controls)`
 * access; no React re-renders (writes module state only). */
function CameraPoseSync() {
  const controls = useThree((s) => s.controls) as {
    target: { x: number; y: number; z: number };
    addEventListener: (t: string, cb: () => void) => void;
    removeEventListener: (t: string, cb: () => void) => void;
  } | null;
  const camera = useThree((s) => s.camera);
  const height = useThree((s) => s.size.height);
  const projection = useEditorStore((s) => s.projection);
  useEffect(() => {
    if (!controls) return;
    let persistTimer: ReturnType<typeof setTimeout> | undefined;
    const onChange = () => {
      const p = camera.position;
      const t = controls.target;
      recordPose(
        projection,
        [p.x, p.y, p.z] as V3,
        [t.x, t.y, t.z] as V3,
        (camera as { zoom?: number }).zoom ?? 1,
        height,
      );
      // persist the RESTING pose to the document (debounced), so it isn't written
      // — and the scene isn't re-rendered — on every orbit frame
      clearTimeout(persistTimer);
      persistTimer = setTimeout(() => {
        const pose = getCameraPose();
        useAppStore.getState().setViewport({
          camera: {
            position: { x: pose.position[0], y: pose.position[1], z: pose.position[2] },
            target: { x: pose.target[0], y: pose.target[1], z: pose.target[2] },
            zoom: pose.zoom,
          },
        });
      }, 600);
    };
    onChange(); // capture the initial pose too (so the first toggle is clean)
    controls.addEventListener('change', onChange);
    return () => {
      clearTimeout(persistTimer);
      controls.removeEventListener('change', onChange);
    };
  }, [controls, camera, height, projection]);
  return null;
}

/** Applies an imperatively-requested pose (view preset / document restore) to
 * the live camera + controls when cameraStore's pose version changes. */
function ViewController() {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as {
    target: { set: (x: number, y: number, z: number) => void };
    update: () => void;
  } | null;
  const applied = useRef(getPoseVersion());
  useFrame(() => {
    const v = getPoseVersion();
    if (v === applied.current) return;
    applied.current = v;
    const p = getCameraPose();
    camera.position.set(p.position[0], p.position[1], p.position[2]);
    const c = camera as { zoom?: number; updateProjectionMatrix?: () => void };
    if (typeof c.zoom === 'number') {
      c.zoom = p.zoom;
      c.updateProjectionMatrix?.();
    }
    if (controls) {
      controls.target.set(p.target[0], p.target[1], p.target[2]);
      controls.update();
    }
  });
  return null;
}

// Ease at ~40 ms time-constant; skip animation past this many nodes (e.g. the
// T-rex) so large designs never pay per-frame re-renders.
const EASE_TAU = 0.045;
const MAX_ANIMATED_NODES = 160;

/** Drives the eased render positions once per frame (see state/animStore).
 * When lengths are locked and pivots exist, the target positions come from the
 * solver (pose kinematics); otherwise from the document. */
function GeometryAnimator() {
  useFrame((_, dt) => {
    const design = useAppStore.getState().current;
    if (!design) return;
    const simulating = useEditorStore.getState().simulating;

    // Play mode: step the CrashCat rigid-body world and render body positions.
    if (simulating) {
      const hash = physicsTopoHash(design);
      if (!physicsActive() || activeTopoHash() !== hash) startPhysics(design);
      stepPhysics(dt);
      const pos = physicsNodePositions();
      const target = design.nodes.map((n) => ({ id: n.id, position: pos[n.id] ?? n.position }));
      stepEasing(target, 1, true); // physics is already smooth — no extra easing
      bumpAnim();
      return;
    }
    if (physicsActive()) stopPhysics(); // just stopped — sim disposed, revert to doc

    let target: Array<{ id: string; position: Vec3 }> = design.nodes;
    if (design.lengthsLocked && design.joints.length) {
      const r = solve(
        design,
        {
          lengthsLocked: true,
          pivotAngles: pivotAnglesOf(design),
          jointOrientations: jointOrientationsOf(design),
        },
        'pose',
      );
      target = design.nodes.map((n) => ({
        id: n.id,
        position: r.nodePositions[n.id] ?? n.position,
      }));
    }
    const instant = design.nodes.length > MAX_ANIMATED_NODES;
    const alpha = Math.min(1, 1 - Math.exp(-dt / EASE_TAU));
    if (stepEasing(target, alpha, instant)) bumpAnim();
  });
  return null;
}

/** Publishes camera / controls / projection seams onto window.__pvc so scripted
 * checks can verify the viewport (e.g. that a handle drag doesn't leave
 * OrbitControls disabled). No-op for real users. */
function DebugBridge() {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const controls = useThree((s) => s.controls) as {
    enabled: boolean;
    target?: { x: number; y: number; z: number };
  } | null;
  useEffect(() => {
    const w = window as unknown as { __pvc?: Record<string, unknown> };
    if (!w.__pvc) w.__pvc = {};
    w.__pvc.getCameraPos = () => ({
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
    });
    w.__pvc.getCameraTarget = () =>
      controls?.target
        ? { x: controls.target.x, y: controls.target.y, z: controls.target.z }
        : null;
    w.__pvc.isControlsEnabled = () => (controls ? controls.enabled : null);
    // scene mesh census — for verifying instancing keeps draw calls low: plain
    // meshes vs InstancedMesh count vs total instances across all instanced meshes
    w.__pvc.sceneStats = () => {
      let meshes = 0;
      let instanced = 0;
      let instances = 0;
      scene.traverse((o) => {
        const m = o as { isInstancedMesh?: boolean; isMesh?: boolean; count?: number };
        if (m.isInstancedMesh) {
          instanced++;
          instances += m.count ?? 0;
        } else if (m.isMesh) meshes++;
      });
      return { meshes, instanced, instances };
    };
    w.__pvc.getEasedPos = (id: string) => easedPos(id) ?? null;
    // orthographic zoom factor (rises as you zoom in) — for verifying wheel zoom
    w.__pvc.getZoom = () => (camera as { zoom?: number }).zoom ?? null;
    const toScreen = (p: { x: number; y: number; z: number }): Pt => {
      const rect = gl.domElement.getBoundingClientRect();
      const v = new Vector3(p.x, p.y, p.z).project(camera);
      return {
        x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
        y: rect.top + (-v.y * 0.5 + 0.5) * rect.height,
      };
    };
    w.__pvc.screenOf = (p: { x: number; y: number; z: number }) => toScreen(p);
    // rubber-band select: hit-test members against the screen rect, set the
    // selection, and return the matched ids (left→right contained, right→left
    // touching)
    w.__pvc.marquee = (x0: number, y0: number, x1: number, y1: number) => {
      const design = useAppStore.getState().current;
      if (!design) return [];
      const { rect, mode } = marqueeFromDrag(x0, y0, x1, y1);
      const at = (id: string) => easedPos(id) ?? nodeById(design, id)?.position;
      const hits = design.members
        .filter((m) => {
          const a = at(m.nodeA);
          const b = at(m.nodeB);
          if (!a || !b) return false;
          const worlds = m.kind === 'formed' ? [a, ...m.controlPoints, b] : [a, b];
          return memberSelectedBy(worlds.map(toScreen), rect, mode);
        })
        .map((m) => m.id);
      return setSelectionGroupAware(hits);
    };
  });
  return null;
}
